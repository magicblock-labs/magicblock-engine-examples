#!/bin/bash

# Suppress job control messages (we don't need monitor mode here, and toggling it
# was previously corrupting the tty mid-run on macOS).
set +m

# Restore sane terminal modes in case a previous run left the tty in raw mode.
stty sane 2>/dev/null || true

SOLANA_PID=""
EPHEMERAL_PID=""
VRF_PID=""
PASSED_TESTS=()
FAILED_TESTS=()
FAILED_TESTS_NAMES=()
FAILED_TESTS_ERRORS=()
TEST_COUNT=0

# Optional first arg: substring filter for test names.
#   bash test-locally.sh                       # runs everything
#   bash test-locally.sh ephemeral-account-chats   # only that one
#   bash test-locally.sh pinocchio             # matches both pinocchio-* examples
TEST_FILTER="${1:-}"
if [ -n "$TEST_FILTER" ]; then
  echo "Filter: only running tests matching '$TEST_FILTER'"
  echo ""
fi

# Portable line reverser: GNU has tac, macOS has tail -r.
if command -v tac >/dev/null 2>&1; then
  reverse_lines() { tac "$@"; }
else
  reverse_lines() { tail -r "$@"; }
fi

# Test runner function
run_test() {
  local test_name=$1
  local test_command=$2
  local test_log="/tmp/test_${test_name}.log"

  # Honor the script's TEST_FILTER substring (first CLI arg).
  if [ -n "$TEST_FILTER" ] && [[ "$test_name" != *"$TEST_FILTER"* ]]; then
    return
  fi

  ((TEST_COUNT++))

  echo ""
  echo "========================================"
  echo "Testing: $TEST_COUNT. $test_name"
  echo "========================================"
  # Test target summary — pulled from the env this script exports.
  # Program ID is best-effort: scans the project's target/deploy for the first keypair.
  local project_dir="${test_name%% *}"  # take token before first space (e.g. "roll-dice + ...")
  local program_id="(deploy first)"
  local keypair
  keypair=$(ls "$project_dir"/target/deploy/*-keypair.json 2>/dev/null | head -1)
  if [ -n "$keypair" ] && command -v solana-keygen >/dev/null 2>&1; then
    program_id=$(solana-keygen pubkey "$keypair" 2>/dev/null || echo "(unreadable)")
  fi
  # Wallet: read pubkey from ~/.config/solana/id.json (the script ensures it exists at startup).
  local wallet="(unknown)"
  if [ -f "$HOME/.config/solana/id.json" ] && command -v solana-keygen >/dev/null 2>&1; then
    wallet=$(solana-keygen pubkey "$HOME/.config/solana/id.json" 2>/dev/null || echo "(unreadable)")
  fi
  # Pick env values out of the test_command's inline prefix (TEE_ENV) — those
  # override the globally exported localnet defaults for this specific run.
  local cmd_base="$(echo "$test_command" | grep -oE 'PROVIDER_ENDPOINT=[^ ]+' | head -1 | cut -d= -f2-)"
  local cmd_er="$(echo "$test_command" | grep -oE 'EPHEMERAL_PROVIDER_ENDPOINT=[^ ]+' | head -1 | cut -d= -f2-)"
  local cmd_validator="$(echo "$test_command" | grep -oE 'VALIDATOR=[A-Za-z0-9]+' | head -1 | cut -d= -f2-)"
  echo "Base Layer Endpoint: ${cmd_base:-${PROVIDER_ENDPOINT:-http://localhost:8899}}"
  echo "ER Endpoint:         ${cmd_er:-${EPHEMERAL_PROVIDER_ENDPOINT:-${TEE_PROVIDER_ENDPOINT:-http://localhost:7799}}}"
  echo "ER Validator:        ${cmd_validator:-${VALIDATOR:-mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev}}"
  echo "Wallet:              $wallet"
  echo "Program ID:          $program_id"
  echo ""

  # Start test in background and monitor progress
  ( FORCE_COLOR=1 CARGO_TERM_COLOR=always NO_COLOR= eval "$test_command" ) > "$test_log" 2>&1 &
  local test_pid=$!
  
  # Handle interrupt signal to kill test
  trap "kill -TERM $test_pid 2>/dev/null; exit 1" INT TERM
  
  # Progress indicator spinner
  local spinner=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
  local dots=("." ".." "...")
  local spinner_idx=0
  local dots_idx=0
  local last_status=""
  local last_stage=""
  local stage_start_time=$SECONDS
  local stage_times=""

  # Map a verbose status to its canonical stage name. Each stage is timed once,
  # regardless of how many sub-statuses we cycle through inside it.
  classify_stage() {
    case "$1" in
      Building*) echo "Building" ;;
      Deploying*|Confirming*) echo "Deploying" ;;
      Resolving*|Dependencies*|Installing*) echo "Installing" ;;
      Running*|*tests*|*Testing*) echo "Testing" ;;
      *) echo "Preparing" ;;
    esac
  }

  # Monitor test progress
  while kill -0 $test_pid 2>/dev/null; do
    # Detect current action by checking log contents
    local current_status=""

    # Get the most recent meaningful line from log
    local last_line=$(tail -1 "$test_log" 2>/dev/null)

    # Order matters: later stages override earlier ones (since log keeps growing).
    # Vitest output is wrapped in ANSI escapes (FORCE_COLOR=1), so we grep for
    # ANSI-resistant fragments: "Test Files" header, "Duration", "Tests  N passed",
    # and the unicode test-file checkmarks vitest emits.
    if grep -qE "passing|failing|Test Files|Tests +[0-9]+ +(passed|failed)|Duration +[0-9]" "$test_log" \
       || grep -qE "RUN +v[0-9]" "$test_log" \
       || grep -q "Running test suite\|Running.*ts-mocha\|Running.*vitest\|ts-mocha.*tests" "$test_log"; then
      current_status="Running tests"
    elif grep -q "Waiting for program" "$test_log"; then
      local prog_id=$(grep "Waiting for program" "$test_log" | tail -1 | sed 's/.*for program \([^ ]*\).*/\1/')
      current_status="Confirming $prog_id"
    elif grep -q "Deploying program" "$test_log"; then
      local prog_name=$(grep "Deploying program" "$test_log" | tail -1 | sed 's/.*Deploying program "\([^"]*\)".*/\1/')
      current_status="Deploying $prog_name"
    elif grep -q "Resolving packages" "$test_log" && ! grep -q "success Already" "$test_log"; then
      current_status="Resolving dependencies"
    elif grep -q "success Already" "$test_log"; then
      current_status="Dependencies installed"
    elif grep -q "Compiling\|Checking" "$test_log"; then
      local crate=$(echo "$last_line" | sed 's/.*Compiling \([^ ]*\).*/\1/' | sed 's/.*Checking \([^ ]*\).*/\1/')
      current_status="Building $crate"
    elif grep -q "Finished.*target" "$test_log"; then
      current_status="Building"
    else
      current_status="Preparing"
    fi

    local current_stage
    current_stage=$(classify_stage "$current_status")

    # Stage transition: record elapsed for the stage we're leaving (not Preparing).
    if [ "$current_stage" != "$last_stage" ]; then
      if [ -n "$last_stage" ] && [ "$last_stage" != "Preparing" ]; then
        local elapsed=$((SECONDS - stage_start_time))
        stage_times+="${last_stage}:${elapsed} "
      fi
      stage_start_time=$SECONDS
      last_stage="$current_stage"
    fi

    # Always redraw the spinner line with current detail + stage elapsed.
    # \033[2K clears the entire current line, \r returns cursor to col 0.
    # More robust than \r + trailing spaces on terminals that drop CR processing.
    if [ "$current_status" != "$last_status" ]; then
      printf '\033[2K\r  %s %s%s' "${spinner[$spinner_idx]}" "$current_status" "${dots[$dots_idx]}"
      last_status="$current_status"
    else
      local current_elapsed=$((SECONDS - stage_start_time))
      printf '\033[2K\r  %s %s (%ss)%s' "${spinner[$spinner_idx]}" "$current_status" "$current_elapsed" "${dots[$dots_idx]}"
    fi

    spinner_idx=$(( (spinner_idx + 1) % 10 ))
    dots_idx=$(( (dots_idx + 1) % 3 ))
    sleep 0.5
  done
  
  # Wait for completion and capture exit code as the primary failure signal.
  # Log-grep checks (X failing / error[ / could not compile) catch the common
  # mocha+rustc messages, but plenty of failures (anchor deploy errors, yarn
  # install crashes, errors before mocha's summary, etc.) only show via $?.
  wait $test_pid
  local test_exit_code=$?

  local test_failed=false
  if [ $test_exit_code -ne 0 ]; then
    test_failed=true
  elif grep -q "[0-9] failing" "$test_log" || grep -q "error\[" "$test_log" || grep -q "could not compile" "$test_log"; then
    test_failed=true
  fi
  
  # Clear the progress line.
  printf '\033[2K\r'

  # Record elapsed for the final stage (skip Preparing).
  if [ -n "$last_stage" ] && [ "$last_stage" != "Preparing" ]; then
    local elapsed=$((SECONDS - stage_start_time))
    stage_times+="${last_stage}:${elapsed} "
  fi
  
  # If tests ran but we didn't capture testing time, add it
  if grep -q "passing\|failing" "$test_log" && ! echo "$stage_times" | grep -q "Testing"; then
    stage_times+="Testing:1 "
  fi
  
  # Trim trailing space
  stage_times="${stage_times% }"
  
  # Debug: remove this line after testing
  # echo "DEBUG stage_times: [$stage_times]" >&2
  
  # If test failed, show all output; if passed, show only summary
  if [ "$test_failed" = true ]; then
    # Show full output on failure
    cat "$test_log"
  else
    # Show only stage completion markers on success with timing
    local stages_completed=""
    
    # Parse stage_times and display with timing
    if [ -n "$stage_times" ]; then
      for stage_timing in $stage_times; do
        local stage_name="${stage_timing%:*}"
        local duration="${stage_timing#*:}"
        case "$stage_name" in
          "Building") stages_completed+="✓ Building (${duration}s)  " ;;
          "Deploying") stages_completed+="✓ Deploying (${duration}s)  " ;;
          "Installing") stages_completed+="✓ Installing (${duration}s)  " ;;
          "Testing") stages_completed+="✓ Testing (${duration}s)" ;;
        esac
      done
    fi
    
    # Fallback if no stage_times were captured
    if [ -z "$stages_completed" ]; then
      if grep -q "Finished.*profile" "$test_log"; then
        stages_completed+="✓ Building  "
      fi
      if grep -q "Deploy success" "$test_log"; then
        stages_completed+="✓ Deploying  "
      fi
      if grep -q "yarn install\|success Already" "$test_log"; then
        stages_completed+="✓ Installing  "
      fi
      if grep -q "passing" "$test_log"; then
        stages_completed+="✓ Testing"
      fi
    fi
    
    if [ -n "$stages_completed" ]; then
      echo "  $stages_completed"
    fi
  fi
  
  # Classify based on `test_failed` (computed from exit code + log grep above).
  if [ "$test_failed" = true ]; then
    FAILED_TESTS+=("$test_name")

    # Extract details from the most informative source available.
    local error_details=""
    if grep -q "[0-9] failing" "$test_log"; then
      error_details=$(reverse_lines "$test_log" | sed -n '/^  [0-9]\+)/,/^[[:space:]]*$/p' | reverse_lines)
      if [ -z "$error_details" ]; then
        error_details=$(tail -500 "$test_log" | sed -n '/failing/,$p' | head -400)
      fi
    elif grep -q "error\[" "$test_log"; then
      error_details=$(grep -B 2 -A 8 "error\[" "$test_log" | head -60)
    elif grep -q "could not compile" "$test_log"; then
      error_details=$(grep -B 3 -A 5 "could not compile" "$test_log" | head -60)
    fi
    if [ -z "$error_details" ]; then
      # Last-resort: surface anything that looks like an error in the tail.
      error_details=$(tail -200 "$test_log" | grep -E -i "^error|Error:|failed|cannot|✗" | head -40)
    fi
    if [ -z "$error_details" ]; then
      error_details="(exit code $test_exit_code — see $test_log for full output)"
    fi

    FAILED_TESTS_NAMES+=("$test_name")
    FAILED_TESTS_ERRORS+=("$error_details")
  else
    PASSED_TESTS+=("$test_name")
  fi
  
  # Print result
  echo ""
  if [[ " ${FAILED_TESTS[@]} " =~ " ${test_name} " ]]; then
    echo "Result: ✗ FAILED"
  else
    echo "Result: ✓ PASSED"
  fi
  echo "========================================"
  echo ""
}

# Cleanup function
cleanup() {
  # Disable trap to prevent recursion
  trap - EXIT INT TERM
  
  # Clear current line.
  printf '\033[2K\r\n'
  printf 'Stopping validators... '
  
  # Kill by PID if available
  for pid in $SOLANA_PID $EPHEMERAL_PID $VRF_PID; do
    [ -n "$pid" ] && kill -TERM $pid 2>/dev/null || true
  done

  # Give them a moment to gracefully shutdown
  sleep 1

  # Force kill any remaining processes
  for pid in $SOLANA_PID $EPHEMERAL_PID $VRF_PID; do
    [ -n "$pid" ] && kill -9 $pid 2>/dev/null || true
  done

  # Also kill by process name as fallback (mb-test-validator wraps solana-test-validator).
  pkill -f "solana-test-validator" 2>/dev/null || true
  pkill -f "mb-test-validator" 2>/dev/null || true
  pkill -f "ephemeral-validator" 2>/dev/null || true
  pkill -f "vrf-oracle" 2>/dev/null || true
  
  # Wait for background jobs silently
  { wait 2>/dev/null || true; } 2>/dev/null
  
  # Check if validators are actually stopped
  if ! pgrep -f "solana-test-validator" >/dev/null 2>&1 \
     && ! pgrep -f "mb-test-validator" >/dev/null 2>&1 \
     && ! pgrep -f "ephemeral-validator" >/dev/null 2>&1 \
     && ! pgrep -f "vrf-oracle" >/dev/null 2>&1; then
    echo "✓ Stopped"
  else
    echo "✗ Failed to stop"
  fi
  
  exit 0
}

# Set up trap to catch INT (Ctrl+C), TERM, and EXIT
trap cleanup EXIT INT TERM

echo "Installing dependencies..."
cd test-utils && yarn install && cd ..

echo "Starting validators..."

# Configure Solana
solana config set --url localhost

# Create keypair only if it doesn't exist
if [ ! -f ~/.config/solana/id.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
fi

# Start MagicBlock Test Validator (wraps solana-test-validator and pre-clones MB programs).
echo "Starting MagicBlock Test Validator..."
mb-test-validator --reset > ./test-ledger.log 2>&1 < /dev/null &

SOLANA_PID=$!

# Wait for validator to be ready
echo "Waiting for Solana validator..."
for i in {1..30}; do
  if solana cluster-version --url http://localhost:8899 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
echo "Solana validator is ready, waiting for RPC to stabilize..."

# Start MagicBlock Ephemeral Validator
echo "Starting MagicBlock Ephemeral Validator..."
EPHEMERAL_VALIDATOR_BIN=$(command -v ephemeral-validator 2>/dev/null)
if [ -z "$EPHEMERAL_VALIDATOR_BIN" ]; then
  echo "ERROR: 'ephemeral-validator' not on PATH. Install with:"
  echo "  npm install -g @magicblock-labs/ephemeral-validator"
  exit 1
fi
echo "  Binary: $EPHEMERAL_VALIDATOR_BIN"
echo "  Version: $("$EPHEMERAL_VALIDATOR_BIN" --version 2>&1 | head -1 || echo unknown)"
RUST_LOG=info "$EPHEMERAL_VALIDATOR_BIN" \
  --lifecycle ephemeral \
  --remotes http://localhost:8899 \
  --listen 127.0.0.1:7799 > ./ephemeral-validator.log 2>&1 < /dev/null &

EPHEMERAL_PID=$!

# Wait for ephemeral-validator RPC to come up — without this, fast tests fire
# their first ER call before the server is listening and hit "fetch failed".
# Using bash's /dev/tcp (no external process; doesn't touch tty).
echo "Waiting for ephemeral-validator..."
for i in {1..60}; do
  if (echo > /dev/tcp/127.0.0.1/7799) 2>/dev/null; then
    sleep 1   # let the RPC handler finish wiring up after the socket binds
    break
  fi
  if ! kill -0 $EPHEMERAL_PID 2>/dev/null; then
    echo "ephemeral-validator died. Last 100 lines of ./ephemeral-validator.log:"
    echo "----- ephemeral-validator.log -----"
    tail -100 ./ephemeral-validator.log 2>/dev/null || echo "(log file not found)"
    echo "----- end of log -----"
    exit 1
  fi
  sleep 1
done
echo "Ephemeral validator is ready."

# Start the VRF oracle (needed by rewards-delegated-vrf).
echo "Starting VRF oracle..."
VRF_ORACLE_BIN=$(command -v vrf-oracle 2>/dev/null)
if [ -z "$VRF_ORACLE_BIN" ]; then
  echo "WARN: 'vrf-oracle' not on PATH — VRF-dependent tests will fail. Install it and re-run."
else
  echo "  Binary: $VRF_ORACLE_BIN"
  VRF_ORACLE_SKIP_PREFLIGHT="true" \
  RPC_URL="http://localhost:8899" \
  WEBSOCKET_URL="ws://localhost:8999" \
  RUST_LOG=info \
    "$VRF_ORACLE_BIN" > ./vrf-oracle.log 2>&1 < /dev/null &
  VRF_PID=$!
  # Brief readiness wait — the oracle subscribes to events; no port to probe,
  # so we just confirm the process is still alive after a moment.
  sleep 2
  if ! kill -0 $VRF_PID 2>/dev/null; then
    echo "VRF oracle died. Last 50 lines of ./vrf-oracle.log:"
    tail -50 ./vrf-oracle.log 2>/dev/null || true
  else
    echo "VRF oracle is running (PID $VRF_PID)."
  fi
fi

# Re-assert tty modes in case a validator's startup poked them.
stty sane </dev/tty 2>/dev/null || true

echo "Validators ready. Running tests..."
echo ""

# MagicBlock validator identities (used as the `validator` arg when delegating):
#   Localnet:
#     Local ER (http://localhost:7799)            : mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev
#   Devnet:
#     Asia (https://devnet-as.magicblock.app)     : MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57
#     EU   (https://devnet-eu.magicblock.app)     : MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e
#     US   (https://devnet-us.magicblock.app)     : MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd
#     TEE  (https://devnet-tee.magicblock.app)    : MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo

# ---- Local tests: base layer = local solana-test-validator; ER = local ephemeral-validator ----
# Exported so every child test process sees them (and any test that ignores them
# and dials devnet will fail loudly rather than silently hit the wrong network).
export PROVIDER_ENDPOINT=http://localhost:8899
export WS_ENDPOINT=ws://localhost:8900
export EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799
export EPHEMERAL_WS_ENDPOINT=ws://localhost:7800
# Anchor SDK reads ANCHOR_PROVIDER_URL/ANCHOR_WALLET when test code calls
# AnchorProvider.env(). Without these, `anchor test` overrides them based on the
# Anchor.toml [provider] cluster (often devnet) and tests silently hit the wrong network.
export ANCHOR_PROVIDER_URL=$PROVIDER_ENDPOINT
export ANCHOR_WALLET="${HOME}/.config/solana/id.json"
# Router-style tests (advanced-magic, magic-actions, dummy-token-transfer) point at the
# MagicBlock router on devnet — locally there's no router, so route them at the local ER.
export ROUTER_ENDPOINT=$EPHEMERAL_PROVIDER_ENDPOINT
export ROUTER_WS_ENDPOINT=$EPHEMERAL_WS_ENDPOINT
export VALIDATOR=mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev

# anchor-counter has 3 test files: public-counter (local), private-counter (TEE), advanced-magic (router).
# Locally we run only public-counter.ts. The other two run from the TEE/devnet block below.
run_test "anchor-counter" "cd anchor-counter && anchor build && anchor deploy --provider.cluster localnet && yarn install && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/public-counter.ts; cd .."

# private-counter is TEE-only — runs in the TEE/devnet block below.

# crank-counter: bypass `anchor test` — Anchor.toml has cluster=devnet so anchor would
# re-set ANCHOR_PROVIDER_URL to devnet, overriding our local export.
run_test "crank-counter" "cd crank-counter && anchor build && anchor deploy --provider.cluster localnet && yarn install && npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.ts'; cd .."

# dummy-token-transfer uses MagicSVM in-process rather than the local validators.
# Its package script builds the program and runs the current tests with
# --skip-local-validator/--skip-deploy.
run_test "dummy-token-transfer" "cd dummy-token-transfer && yarn install && yarn test; cd .."

# ephemeral-account-chats: bypass `anchor test` — Anchor.toml has cluster=devnet so
# anchor would re-set ANCHOR_PROVIDER_URL to devnet, overriding our local export.
run_test "ephemeral-account-chats" "cd ephemeral-account-chats && anchor build && anchor deploy --provider.cluster localnet && yarn install && npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.ts'; cd .."

run_test "magic-actions" "cd magic-actions && anchor build && anchor deploy --provider.cluster localnet && yarn install && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/magic-actions-local.ts; cd .."

run_test "oncurve-delegation" "cd oncurve-delegation && yarn install && yarn test && yarn test-web3js; cd .."

run_test "pinocchio-counter" "cd pinocchio-counter && cargo build-sbf && solana program deploy --program-id target/deploy/pinocchio_counter-keypair.json target/deploy/pinocchio_counter.so && yarn install && yarn test; cd .."

run_test "pinocchio-secret-counter" "cd pinocchio-secret-counter && cargo build-sbf && solana program deploy --program-id target/deploy/pinocchio_secret_counter-keypair.json target/deploy/pinocchio_secret_counter.so && yarn install && yarn test; cd .."

# rewards-delegated-vrf: bypass `anchor test` — Anchor.toml has cluster=devnet so anchor
# would re-set ANCHOR_PROVIDER_URL to devnet, overriding our local export.
run_test "rewards-delegated-vrf" "cd rewards-delegated-vrf && anchor build && anchor deploy --provider.cluster localnet && yarn install && npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.ts'; cd .."

# roll-dice + roll-dice-delegated: VRF integration. roll-dice-delegated reads
# VALIDATOR env var → defaults to the local-ER validator since EPHEMERAL_PROVIDER_ENDPOINT
# is localhost. Same Anchor.toml glob picks up both test files.
run_test "roll-dice" "cd roll-dice && anchor build && anchor deploy --provider.cluster localnet && yarn install && npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.ts'; cd .."

# rust-counter: skip ./tests/kit/advanced-magic.test.ts — it's router-based (devnet-router).
run_test "rust-counter" "cd rust-counter && yarn install && npx vitest run ./tests/kit/rust-counter.test.ts; cd .."

# session-keys: skip ./tests/advanced-magic.ts — it's router-based (devnet-router).
run_test "session-keys" "cd session-keys && anchor build && yarn install && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/anchor-counter-session.ts; cd .."

# spl-tokens: bypass `anchor test` (which calls fullstack-test.sh — that script
# branches on Anchor.toml's cluster=devnet and overrides ANCHOR_PROVIDER_URL,
# fighting our locally-exported env). Invoke ts-mocha directly.
run_test "spl-tokens" "cd spl-tokens && anchor build && anchor deploy --provider.cluster localnet && yarn install && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/spl-tokens.ts; cd .."

# ---- TEE tests: base layer = Solana devnet; ER = MagicBlock TEE devnet ----
# TEE attestation isn't available locally, so these examples are tested against
# devnet TEE (validator MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo).
# Requires: solana CLI default keypair funded with devnet SOL for the program deploy.
# Set SKIP_TEE_TESTS=1 to skip this block.
# Override the base-layer devnet RPC via DEVNET_RPC_URL (e.g. a private Helius/QuickNode
# endpoint) to avoid public devnet rate limits. The WS URL is derived from it.
if [ "${SKIP_TEE_TESTS:-0}" != "1" ]; then
  DEVNET_RPC="${DEVNET_RPC_URL:-https://api.devnet.solana.com}"
  DEVNET_WS=$(echo "$DEVNET_RPC" | sed -e 's|^http:|ws:|' -e 's|^https:|wss:|')

  TEE_ENV="PROVIDER_ENDPOINT=$DEVNET_RPC WS_ENDPOINT=$DEVNET_WS EPHEMERAL_PROVIDER_ENDPOINT=https://devnet-tee.magicblock.app EPHEMERAL_WS_ENDPOINT=wss://devnet-tee.magicblock.app TEE_PROVIDER_ENDPOINT=https://devnet-tee.magicblock.app TEE_WS_ENDPOINT=wss://devnet-tee.magicblock.app ROUTER_ENDPOINT=https://devnet-router.magicblock.app ROUTER_WS_ENDPOINT=wss://devnet-router.magicblock.app VALIDATOR=MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"

  run_test "private-counter (devnet TEE)" "cd private-counter && anchor build && anchor deploy --provider.cluster devnet && yarn install && $TEE_ENV anchor test --skip-build --skip-deploy --skip-local-validator --provider.cluster devnet; cd .."

  run_test "rock-paper-scissor (devnet TEE)" "cd rock-paper-scissor && anchor build && anchor deploy --provider.cluster devnet && yarn install && $TEE_ENV anchor test --skip-build --skip-deploy --skip-local-validator --provider.cluster devnet; cd .."
fi

# Print summary report
echo "========================================"
echo "TEST SUMMARY REPORT"
echo "========================================"
echo ""
echo "PASSED TESTS (${#PASSED_TESTS[@]}):"
if [ ${#PASSED_TESTS[@]} -eq 0 ]; then
  echo "  None"
else
  for test in "${PASSED_TESTS[@]}"; do
    echo "  ✓ $test"
  done
fi
echo ""
echo "FAILED TESTS (${#FAILED_TESTS[@]}):"
if [ ${#FAILED_TESTS[@]} -eq 0 ]; then
  echo "  None"
else
  for test in "${FAILED_TESTS[@]}"; do
    echo "  ✗ $test"
  done
fi
echo ""
echo "========================================"
echo "Total: ${#PASSED_TESTS[@]} passed, ${#FAILED_TESTS[@]} failed"
echo "========================================"
echo ""

# Print detailed error report for failed tests
if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
  echo "========================================"
  echo "FAILED TESTS - ERROR DETAILS"
  echo "========================================"
  echo ""
  for i in "${!FAILED_TESTS_NAMES[@]}"; do
    echo "--- ${FAILED_TESTS_NAMES[$i]} ---"
    echo "${FAILED_TESTS_ERRORS[$i]}"
    echo ""
  done
fi
