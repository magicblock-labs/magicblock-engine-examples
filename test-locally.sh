#!/bin/bash

# Suppress job control messages (we don't need monitor mode here, and toggling it
# was previously corrupting the tty mid-run on macOS).
set +m

# Restore sane terminal modes in case a previous run left the tty in raw mode.
stty sane 2>/dev/null || true

SOLANA_PID=""
EPHEMERAL_PID=""
PASSED_TESTS=()
FAILED_TESTS=()
FAILED_TESTS_NAMES=()
FAILED_TESTS_ERRORS=()
TEST_COUNT=0

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
  echo "Base Layer Endpoint: ${PROVIDER_ENDPOINT:-?}"
  echo "ER Endpoint:         ${EPHEMERAL_PROVIDER_ENDPOINT:-${TEE_PROVIDER_ENDPOINT:-?}}"
  echo "ER Validator:        ${VALIDATOR:-?}"
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
    if [ "$current_status" != "$last_status" ]; then
      echo -ne "\r  ${spinner[$spinner_idx]} $current_status${dots[$dots_idx]}                                    "
      last_status="$current_status"
    else
      local current_elapsed=$((SECONDS - stage_start_time))
      echo -ne "\r  ${spinner[$spinner_idx]} $current_status (${current_elapsed}s)${dots[$dots_idx]}                                    "
    fi

    spinner_idx=$(( (spinner_idx + 1) % 10 ))
    dots_idx=$(( (dots_idx + 1) % 3 ))
    sleep 0.5
  done
  
  # Wait for completion
  wait $test_pid
  
  # Check if test failed
  local test_failed=false
  if grep -q "[0-9] failing" "$test_log" || grep -q "error\[" "$test_log" || grep -q "could not compile" "$test_log"; then
    test_failed=true
  fi
  
  # Clear the progress line
  echo -ne "\r                                                                                  \r"
  
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
  
  # Check if test actually failed by looking for failure indicators
  # Check for mocha test failures (X failing)
  if grep -q "[0-9] failing" "$test_log"; then
    FAILED_TESTS+=("$test_name")
    
    # Extract test failures section - find last occurrence of test suite and get failures from there
    # Get the last test suite block (after the last blank line followed by test name pattern)
    local error_details=$(reverse_lines "$test_log" | sed -n '/^  [0-9]\+)/,/^[[:space:]]*$/p' | reverse_lines)
    
    if [ -z "$error_details" ]; then
      # Fallback: get from "failing" keyword to end
      error_details=$(tail -500 "$test_log" | sed -n '/failing/,$p' | head -400)
    fi
    
    FAILED_TESTS_NAMES+=("$test_name")
    FAILED_TESTS_ERRORS+=("$error_details")
  # Check for compile errors
  elif grep -q "error\[" "$test_log" || grep -q "could not compile" "$test_log"; then
    FAILED_TESTS+=("$test_name")
    
    # Extract compilation error details
    local error_details=$(grep -B 2 -A 8 "error\[" "$test_log" | head -60)
    if [ -z "$error_details" ]; then
      error_details=$(grep -B 3 -A 5 "could not compile" "$test_log" | head -60)
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
  
  # Clear current line
  echo -ne "\r                                                                                  \r"
  echo ""
  echo -n "Stopping validators... "
  
  # Kill by PID if available
  if [ -n "$SOLANA_PID" ]; then
    kill -TERM $SOLANA_PID 2>/dev/null || true
  fi
  if [ -n "$EPHEMERAL_PID" ]; then
    kill -TERM $EPHEMERAL_PID 2>/dev/null || true
  fi
  
  # Give them a moment to gracefully shutdown
  sleep 1
  
  # Force kill any remaining processes
  if [ -n "$SOLANA_PID" ]; then
    kill -9 $SOLANA_PID 2>/dev/null || true
  fi
  if [ -n "$EPHEMERAL_PID" ]; then
    kill -9 $EPHEMERAL_PID 2>/dev/null || true
  fi
  
  # Also kill by process name as fallback
  pkill -f "solana-test-validator" 2>/dev/null || true
  pkill -f "ephemeral-validator" 2>/dev/null || true
  
  # Wait for background jobs silently
  { wait 2>/dev/null || true; } 2>/dev/null
  
  # Check if validators are actually stopped
  if ! pgrep -f "solana-test-validator" >/dev/null 2>&1 && ! pgrep -f "ephemeral-validator" >/dev/null 2>&1; then
    echo "✓ Stopped"
  else
    echo "✗ Failed to stop"
  fi
  
  exit 0
}

# Set up trap to catch INT (Ctrl+C), TERM, and EXIT
trap cleanup EXIT INT TERM

echo "Starting validators..."

# Configure Solana
solana config set --url localhost

# Create keypair only if it doesn't exist
if [ ! -f ~/.config/solana/id.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
fi

# Start Solana Test Validator
echo "Starting Solana Test Validator..."
solana-test-validator \
  --ledger ./test-ledger \
  --reset \
  --clone-upgradeable-program DmnRGfyyftzacFb1XadYhWF6vWqXwtQk5tbr6XgR3BA1 \
  --clone mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev \
  --clone EpJnX7ueXk7fKojBymqmVuCuwyhDQsYcLVL1XMsBbvDX \
  --clone 7JrkjmZPprHwtuvtuGTXp9hwfGYFAQLnLeFM52kqAgXg \
  --clone noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV \
  --clone-upgradeable-program DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh \
  --clone Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh \
  --clone 5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc \
  --clone F72HqCR8nwYsVyeVd38pgKkjXmXFzVAM8rjZZsXWbdE \
  --clone vrfkfM4uoisXZQPrFiS2brY4oMkU9EWjyvmvqaFd5AS \
  --clone-upgradeable-program Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz \
  --clone-upgradeable-program BTWAqWNBmF2TboMh3fxMJfgR16xGHYD7Kgr2dPwbRPBi \
  --clone-upgradeable-program ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1 \
  --clone-upgradeable-program SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2 \
  --clone-upgradeable-program Hydra17i1feui9deaxu6d1TzSQMRNHeBRkDR1Awy7zea \
  --url https://api.devnet.solana.com > ./test-ledger.log 2>&1 < /dev/null &

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
RUST_LOG=info ephemeral-validator \
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
    echo "ephemeral-validator died — see ./ephemeral-validator.log"
    exit 1
  fi
  sleep 1
done
echo "Ephemeral validator is ready."

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

# anchor-rock-paper-scissor uses TEE (base layer hardcoded to devnet) — can't run
# against the local validators here. Move to a future test-devnet.sh.



# crank-counter: bypass `anchor test` — Anchor.toml has cluster=devnet so anchor would
# re-set ANCHOR_PROVIDER_URL to devnet, overriding our local export.
run_test "crank-counter" "cd crank-counter && anchor build && anchor deploy --provider.cluster localnet && yarn install && npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.ts'; cd .."

# dummy-token-transfer and magic-actions have router-based tests (devnet-router) plus
# local *-local.ts variants that use split base/ER connections. test-locally.sh runs
# only the *-local.ts variants. The router ones belong in a future test-devnet.sh.
run_test "dummy-token-transfer" "cd dummy-token-transfer && anchor build && anchor deploy --provider.cluster localnet && yarn install && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/dummy-transfer-local.ts; cd .."

# ephemeral-account-chats skipped locally — move to a future test-devnet.sh.


run_test "magic-actions" "cd magic-actions && anchor build && anchor deploy --provider.cluster localnet && yarn install && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/magic-actions-local.ts; cd .."

run_test "oncurve-delegation" "cd oncurve-delegation && yarn install && yarn test && yarn test-web3js; cd .."

run_test "pinocchio-counter" "cd pinocchio-counter && cargo build-sbf && solana program deploy --program-id target/deploy/pinocchio_counter-keypair.json target/deploy/pinocchio_counter.so && yarn install && yarn test; cd .."

run_test "pinocchio-secret-counter" "cd pinocchio-secret-counter && cargo build-sbf && solana program deploy --program-id target/deploy/pinocchio_secret_counter-keypair.json target/deploy/pinocchio_secret_counter.so && yarn install && yarn test; cd .."

# rewards-delegated-vrf: bypass `anchor test` — Anchor.toml has cluster=devnet so anchor
# would re-set ANCHOR_PROVIDER_URL to devnet, overriding our local export.
run_test "rewards-delegated-vrf" "cd rewards-delegated-vrf && anchor build && anchor deploy --provider.cluster localnet && yarn install && npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.ts'; cd .."

# roll-dice + roll-dice-delegated skipped locally — move to a future test-devnet.sh.



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
if [ "${SKIP_TEE_TESTS:-0}" != "1" ]; then
  TEE_ENV="PROVIDER_ENDPOINT=https://api.devnet.solana.com WS_ENDPOINT=wss://api.devnet.solana.com TEE_PROVIDER_ENDPOINT=https://devnet-tee.magicblock.app TEE_WS_ENDPOINT=wss://devnet-tee.magicblock.app ROUTER_ENDPOINT=https://devnet-router.magicblock.app ROUTER_WS_ENDPOINT=wss://devnet-router.magicblock.app VALIDATOR=MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"

  run_test "anchor-private-counter (devnet TEE)" "cd anchor-private-counter && anchor build && anchor deploy --provider.cluster devnet && yarn install && $TEE_ENV anchor test --skip-build --skip-deploy --skip-local-validator --provider.cluster devnet; cd .."

  run_test "anchor-counter private-counter (devnet TEE)" "cd anchor-counter && anchor build && anchor deploy --provider.cluster devnet && yarn install && $TEE_ENV npx ts-mocha -p ./tsconfig.json -t 1000000 tests/private-counter.ts; cd .."
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
