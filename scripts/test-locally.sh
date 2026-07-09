#!/bin/bash

# Suppress job control messages (we don't need monitor mode here, and toggling it
# was previously corrupting the tty mid-run on macOS).
set +m

# Restore sane terminal modes in case a previous run left the tty in raw mode.
stty sane 2>/dev/null || true

MB_STACK_PID=""
VRF_PID=""
VRF_ER_PID=""
PASSED_TESTS=()
FAILED_TESTS=()
FAILED_TESTS_NAMES=()
FAILED_TESTS_ERRORS=()
TEST_COUNT=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Optional first arg: substring filter for test names.
#   bash scripts/test-locally.sh                           # runs everything
#   bash scripts/test-locally.sh ephemeral-account-chats   # only that one
#   bash scripts/test-locally.sh pinocchio                 # matches both pinocchio-* examples
#
# Optional env flags:
#   SKIP_REGULAR_TESTS=1  skips regular local tests
#   SKIP_VRF_TESTS=1      skips VRF oracle startup and VRF tests
#   SKIP_TEE_TESTS=1      skips devnet TEE tests
#   FAIL_FAST=0           keep running after a test fails (default: stop on the
#                         first failure and exit non-zero — fail fast for CI)
#   SETUP_ONLY=1          start the validators/oracles, then keep them running
#                         until a key is pressed (no tests). Useful for poking at
#                         the local cluster by hand.
TEST_FILTER="${1:-}"
SKIP_TEE_TESTS="${SKIP_TEE_TESTS:-0}"
SKIP_REGULAR_TESTS="${SKIP_REGULAR_TESTS:-0}"
SKIP_VRF_TESTS="${SKIP_VRF_TESTS:-0}"
FAIL_FAST="${FAIL_FAST:-1}"
# EXACT_MATCH=1 turns TEST_FILTER into an exact project-name match instead of the
# default substring match. Used by scripts/test-example.sh to select a single
# example without over-selecting siblings (e.g. roll-dice vs pinocchio-roll-dice).
EXACT_MATCH="${EXACT_MATCH:-0}"

if [ -n "$TEST_FILTER" ]; then
  echo "Filter: only running tests matching '$TEST_FILTER'"
  echo ""
fi
if [ "$SKIP_REGULAR_TESTS" = "1" ]; then
  echo "Filter: skipping regular tests"
  echo ""
fi
if [ "$SKIP_VRF_TESTS" = "1" ]; then
  echo "Filter: skipping VRF tests"
  echo ""
fi
if [ "$SKIP_TEE_TESTS" = "1" ]; then
  echo "Filter: skipping TEE tests"
  echo ""
fi

# Portable line reverser: GNU has tac, macOS has tail -r.
if command -v tac >/dev/null 2>&1; then
  reverse_lines() { tac "$@"; }
else
  reverse_lines() { tail -r "$@"; }
fi

# True when a project name passes the active TEST_FILTER. With no filter set,
# everything matches. EXACT_MATCH=1 requires an exact name match; otherwise the
# filter is a substring match (the historical behavior).
matches_filter() {
  [ -z "$TEST_FILTER" ] && return 0
  if [ "$EXACT_MATCH" = "1" ]; then
    [ "$1" = "$TEST_FILTER" ]
  else
    [[ "$1" == *"$TEST_FILTER"* ]]
  fi
}

# Run one example's local test. Takes the stable project name and resolves it to
# the current use-case/framework directory. Building + preloading the program
# already happened up front (parallel build phase + validator preload), so this
# just runs `yarn test:local`.
run_test() {
  local test_name=$1
  local test_dir
  test_dir="$(project_dir "$test_name")"
  if [ -z "$test_dir" ]; then
    echo "Unknown project path for '$test_name'"
    return 1
  fi
  local test_log="/tmp/test_${test_name}.log"
  local test_command="cd \"$test_dir\" && yarn test:local"

  # TEE examples reach the ER through the QFS, so they read TEE_PROVIDER_ENDPOINT/
  # TEE_WS_ENDPOINT. Expose those to just those runs (every other endpoint and the
  # validator id are exported globally and shared by all tests).
  case " ${TEE_PROJECTS[*]} " in
    *" $test_name "*)
      test_command="TEE_PROVIDER_ENDPOINT=$QFS_ENDPOINT TEE_WS_ENDPOINT=$QFS_WS_ENDPOINT $test_command"
      ;;
  esac

  # Honor the script's TEST_FILTER (first CLI arg); see matches_filter.
  if ! matches_filter "$test_name"; then
    return
  fi

  ((TEST_COUNT++))

  echo ""
  echo "========================================"
  echo "Testing: $TEST_COUNT. $test_name"
  echo "========================================"
  # Program ID is best-effort: scans the project's target/deploy for the first keypair.
  local program_id="(unknown)"
  local keypair
  keypair=$(ls "$test_dir"/target/deploy/*-keypair.json 2>/dev/null | head -1)
  if [ -n "$keypair" ] && command -v solana-keygen >/dev/null 2>&1; then
    program_id=$(solana-keygen pubkey "$keypair" 2>/dev/null || echo "(unreadable)")
  fi
  # Wallet: read pubkey from ~/.config/solana/id.json (the script ensures it exists at startup).
  local wallet="(unknown)"
  if [ -f "$HOME/.config/solana/id.json" ] && command -v solana-keygen >/dev/null 2>&1; then
    wallet=$(solana-keygen pubkey "$HOME/.config/solana/id.json" 2>/dev/null || echo "(unreadable)")
  fi
  echo "Base Layer Endpoint: ${PROVIDER_ENDPOINT:-http://localhost:8899}"
  echo "ER Endpoint:         ${EPHEMERAL_PROVIDER_ENDPOINT:-http://localhost:7799}"
  echo "ER Validator:        ${VALIDATOR:-mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev}"
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
    sleep 5
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

  # Fail fast: stop the whole run on the first failure (unless FAIL_FAST=0).
  # The detailed error report below is normally printed at the end; print it
  # here too so a fail-fast abort still surfaces why we stopped. Exiting triggers
  # cleanup() (EXIT trap), which stops the validators and propagates code 1.
  if [ "$test_failed" = true ] && [ "$FAIL_FAST" != "0" ]; then
    echo "FAIL_FAST: stopping after first failure ($test_name)."
    echo "  (set FAIL_FAST=0 to run the remaining tests anyway)"
    echo ""
    echo "--- $test_name ---"
    echo "$error_details"
    echo ""
    exit 1
  fi
}

# Cleanup function
cleanup() {
  # Capture the status that triggered this trap *before* running any cleanup
  # commands (which would clobber $?). We re-exit with it so a failed test or an
  # early `exit 1` (e.g. a validator that wouldn't start) surfaces to CI.
  local exit_code=$?
  # Disable trap to prevent recursion
  trap - EXIT INT TERM
  
  # Clear current line.
  printf '\033[2K\r\n'
  printf 'Stopping validators... '
  
  # Kill by PID if available. MB_STACK_PID is mb-stack's own node process; sending
  # it SIGTERM/SIGKILL runs its handler, which in turn signals the process groups
  # of the base validator/ephemeral-validator/QFS it supervises.
  for pid in $MB_STACK_PID $VRF_PID $VRF_ER_PID; do
    [ -n "$pid" ] && kill -TERM $pid 2>/dev/null || true
  done

  # Give them a moment to gracefully shutdown
  sleep 1

  # Force kill any remaining processes
  for pid in $MB_STACK_PID $VRF_PID $VRF_ER_PID; do
    [ -n "$pid" ] && kill -9 $pid 2>/dev/null || true
  done

  # Also kill by process name as fallback, in case mb-stack was killed before it
  # could tear down the services it supervises (mb-test-validator wraps
  # solana-test-validator).
  pkill -f "mb-stack" 2>/dev/null || true
  pkill -f "solana-test-validator" 2>/dev/null || true
  pkill -f "mb-test-validator" 2>/dev/null || true
  pkill -f "ephemeral-validator" 2>/dev/null || true
  pkill -f "query-filtering-service" 2>/dev/null || true
  pkill -f "vrf-oracle" 2>/dev/null || true
  pkill -f "vrf-oracle-er" 2>/dev/null || true
  
  # Wait for background jobs silently
  { wait 2>/dev/null || true; } 2>/dev/null

  # Check if validators are actually stopped
  if ! pgrep -f "solana-test-validator" >/dev/null 2>&1 \
     && ! pgrep -f "mb-test-validator" >/dev/null 2>&1 \
     && ! pgrep -f "ephemeral-validator" >/dev/null 2>&1 \
     && ! pgrep -f "query-filtering-service" >/dev/null 2>&1 \
     && ! pgrep -f "vrf-oracle" >/dev/null 2>&1; then
    echo "✓ Stopped"
  else
    echo "✗ Failed to stop"
  fi

  exit $exit_code
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

# ------------------------------------------------------------------------------
# Example projects, grouped by the test phase that runs them. Defined in
# scripts/projects.sh (single source of truth, shared with scripts/test-example.sh
# and the CI matrix). The project name is the stable CLI/CI identifier; project_dir
# maps it to its use-case/framework directory. Each project exposes `yarn build`
# (compile only) and `yarn test:local` (the local test subset).
# ------------------------------------------------------------------------------
# shellcheck source=scripts/projects.sh
. "$SCRIPT_DIR/projects.sh"

# Set of projects to build = everything the enabled test phases will run, honoring
# the same TEST_FILTER substring the tests use.
BUILD_PROJECTS=()
add_build_projects() {
  for p in "$@"; do
    if ! matches_filter "$p"; then
      continue
    fi
    BUILD_PROJECTS+=("$p")
  done
}
[ "$SKIP_REGULAR_TESTS" = "1" ] || add_build_projects "${REGULAR_PROJECTS[@]}"
[ "$SKIP_VRF_TESTS" = "1" ]     || add_build_projects "${VRF_PROJECTS[@]}"
[ "$SKIP_TEE_TESTS" = "1" ]     || add_build_projects "${TEE_PROJECTS[@]}"

# Build one project: install JS deps + compile the program. The exit status is
# written to a per-project status file so the parallel poller can read it race-free.
build_project() {
  local p="$1"
  local dir
  dir="$(project_dir "$p")"
  if [ -z "$dir" ]; then
    echo "Unknown project path for '$p'" > "/tmp/build_${p}.log"
    echo "1" > "/tmp/build_${p}.status"
    return
  fi
  local log="/tmp/build_${p}.log"
  rm -f "/tmp/build_${p}.status"
  # --mutex serializes cache access across the parallel installs. Without it,
  # concurrent `yarn install` runs writing a shared dependency (e.g. @noble/hashes)
  # race on the global cache and corrupt the extracted tarball ("file appears to
  # be corrupt" / ENOENT on LICENSE). The build step still runs in parallel.
  ( cd "$dir" && yarn install --mutex file:/tmp/.yarn-install-mutex && yarn build ) > "$log" 2>&1
  echo "$?" > "/tmp/build_${p}.status"
}

# Build all programs in parallel (fail fast). They are compiled here, then
# preloaded into the mb-test-validator below from their generated keypair + .so —
# there is no per-test `anchor deploy` / `solana program deploy` step anymore.
if [ "${#BUILD_PROJECTS[@]}" -eq 0 ]; then
  echo "No projects to build (all phases skipped or filtered out)."
else
  echo "Building ${#BUILD_PROJECTS[@]} program(s) in parallel: ${BUILD_PROJECTS[*]}"
  # Clear stale status files from a previous run before forking, so the poller can't
  # mistake an old status for this run's result.
  for p in "${BUILD_PROJECTS[@]}"; do rm -f "/tmp/build_${p}.status"; done

  # Install the SBF platform-tools toolchain serially before forking. On a fresh
  # machine the first real `cargo build-sbf` downloads + extracts platform-tools into
  # one shared global dir; the N parallel builds otherwise race on that extraction and
  # a build that reads it mid-flight sees a half-written tree ("not a directory:
  # .../platform-tools/rust/lib"). `--install-only` downloads + installs the tools
  # without compiling anything, and is a no-op if they're already present. (Note:
  # `--version` does NOT trigger the install — it only prints the version string.)
  # A one-off dummy build-sbf also installs the sbpf rustup toolchain; parallel
  # anchor/cargo build-sbf runs otherwise race on that and leave a broken toolchain.
  if command -v cargo-build-sbf >/dev/null 2>&1; then
    echo "Installing SBF platform-tools (serial, pre-build)..."
    if ! cargo-build-sbf --install-only > /tmp/sbf-warmup.log 2>&1; then
      echo "SBF platform-tools install failed. Last 40 lines of /tmp/sbf-warmup.log:"
      tail -40 /tmp/sbf-warmup.log 2>/dev/null || true
      exit 1
    fi
    sbf_warmup_dir=$(mktemp -d)
    cat > "$sbf_warmup_dir/Cargo.toml" <<'EOF'
[package]
name = "sbf-warmup"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]
path = "lib.rs"
EOF
    echo 'pub fn warm() {}' > "$sbf_warmup_dir/lib.rs"
    if ! ( cd "$sbf_warmup_dir" && cargo-build-sbf >> /tmp/sbf-warmup.log 2>&1 ); then
      echo "SBF rust toolchain warmup failed. Last 40 lines of /tmp/sbf-warmup.log:"
      tail -40 /tmp/sbf-warmup.log 2>/dev/null || true
      rm -rf "$sbf_warmup_dir"
      exit 1
    fi
    rm -rf "$sbf_warmup_dir"
  fi

  # Pre-download yarn via corepack serially before parallel `yarn install` runs.
  # Without this, concurrent builds race on ~/.cache/node/corepack/yarn/* and
  # leave a broken shim (MODULE_NOT_FOUND on lib/cli).
  if command -v corepack >/dev/null 2>&1; then
    echo "Preparing yarn via corepack (serial, pre-build)..."
    corepack enable 2>/dev/null || true
    corepack prepare yarn@1.22.19 --activate >/tmp/corepack-yarn.log 2>&1
    corepack prepare yarn@1.22.22 --activate >>/tmp/corepack-yarn.log 2>&1
  fi

  BUILD_PIDS=()
  for p in "${BUILD_PROJECTS[@]}"; do
    build_project "$p" &
    BUILD_PIDS+=("$!")
  done

  build_total=${#BUILD_PROJECTS[@]}
  build_done=0
  build_failed=""
  declare -a build_finished
  for ((i=0;i<build_total;i++)); do build_finished[$i]=0; done

  while [ "$build_done" -lt "$build_total" ]; do
    for ((i=0;i<build_total;i++)); do
      [ "${build_finished[$i]}" = "1" ] && continue
      p="${BUILD_PROJECTS[$i]}"
      if [ -f "/tmp/build_${p}.status" ]; then
        build_finished[$i]=1
        build_done=$((build_done + 1))
        st=$(cat "/tmp/build_${p}.status" 2>/dev/null || echo 1)
        if [ "$st" = "0" ]; then
          printf '\033[2K\r  ✓ %s\n' "$p"
        else
          printf '\033[2K\r  ✗ %s (build failed, exit %s)\n' "$p" "$st"
          build_failed="$p"
        fi
      fi
    done
    # Fail fast: stop polling as soon as one build fails (unless FAIL_FAST=0).
    if [ -n "$build_failed" ] && [ "$FAIL_FAST" != "0" ]; then
      break
    fi
    printf '\033[2K\r  Building... %d/%d done' "$build_done" "$build_total"
    sleep 5
  done
  printf '\033[2K\r'

  if [ -n "$build_failed" ]; then
    # Stop any builds still running.
    for ((i=0;i<build_total;i++)); do
      [ "${build_finished[$i]}" = "0" ] && kill -TERM "${BUILD_PIDS[$i]}" 2>/dev/null
    done
    wait 2>/dev/null || true
    if [ "$FAIL_FAST" != "0" ]; then
      echo ""
      echo "Build failed for '$build_failed'. Last 80 lines of /tmp/build_${build_failed}.log:"
      echo "----- build_${build_failed}.log -----"
      tail -80 "/tmp/build_${build_failed}.log" 2>/dev/null || echo "(log not found)"
      echo "----- end of log -----"
      exit 1
    else
      echo "  WARNING: some builds failed (FAIL_FAST=0); their tests will likely fail."
    fi
  fi
  echo "Builds complete."
fi

# Collect generated program binaries to preload into the validator. For every
# <name>.so under each project's target/deploy that has a matching
# <name>-keypair.json, add an upgradeable program at the keypair's address with the
# local wallet as upgrade authority — mirroring what `anchor deploy` /
# `solana program deploy` produced before.
PRELOAD_ARGS=()
WALLET_PUBKEY=$(solana-keygen pubkey "$HOME/.config/solana/id.json" 2>/dev/null || echo "")
if [ "${#BUILD_PROJECTS[@]}" -gt 0 ]; then
  echo "Preloading programs into mb-test-validator:"
  for p in "${BUILD_PROJECTS[@]}"; do
    dir="$(project_dir "$p")"
    if [ -z "$dir" ]; then
      echo "  WARNING: no project path for $p; not preloaded."
      continue
    fi
    for so in "$dir"/target/deploy/*.so; do
      [ -e "$so" ] || continue
      kp="${so%.so}-keypair.json"
      if [ -f "$kp" ]; then
        prog=$(solana-keygen pubkey "$kp" 2>/dev/null || echo "(unreadable)")
        echo "  $dir/$(basename "$so") -> $prog"
        PRELOAD_ARGS+=(--upgradeable-program "$kp" "$so" "$WALLET_PUBKEY")
      else
        echo "  WARNING: $so has no matching keypair ($(basename "$kp")); not preloaded."
      fi
    done
    if [ -f "$dir/Anchor.toml" ]; then
      while IFS=$'\t' read -r address program upgradeable; do
        [ -n "$address" ] || continue
        case "$address" in
          SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2|DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh)
            echo "  $dir/$program -> $address (built into mb-test-validator; skipping fixture preload)"
            continue
            ;;
        esac
        fixture="$dir/$program"
        if [ ! -f "$fixture" ]; then
          echo "  WARNING: $dir Anchor.toml fixture $program not found; not preloaded."
          continue
        fi
        if [ "$upgradeable" = "true" ]; then
          echo "  $dir/$program -> $address (upgradeable genesis fixture)"
          PRELOAD_ARGS+=(--upgradeable-program "$address" "$fixture" "$WALLET_PUBKEY")
        else
          echo "  $dir/$program -> $address (genesis fixture)"
          PRELOAD_ARGS+=(--bpf-program "$address" "$fixture")
        fi
      done < <(awk '
        /^\[\[test\.genesis\]\]/ {
          if (address != "" && program != "") print address "\t" program "\t" upgradeable
          in_genesis = 1
          address = ""
          program = ""
          upgradeable = "false"
          next
        }
        /^\[/ && !/^\[\[test\.genesis\]\]/ {
          if (in_genesis && address != "" && program != "") print address "\t" program "\t" upgradeable
          in_genesis = 0
          address = ""
          program = ""
          upgradeable = "false"
          next
        }
        in_genesis && /^[[:space:]]*address[[:space:]]*=/ {
          line = $0
          sub(/^[^=]*=[[:space:]]*"/, "", line)
          sub(/".*$/, "", line)
          address = line
          next
        }
        in_genesis && /^[[:space:]]*program[[:space:]]*=/ {
          line = $0
          sub(/^[^=]*=[[:space:]]*"/, "", line)
          sub(/".*$/, "", line)
          program = line
          next
        }
        in_genesis && /^[[:space:]]*upgradeable[[:space:]]*=/ {
          line = $0
          sub(/^[^=]*=[[:space:]]*/, "", line)
          sub(/[[:space:]]*#.*/, "", line)
          upgradeable = line
          next
        }
        END {
          if (in_genesis && address != "" && program != "") print address "\t" program "\t" upgradeable
        }
      ' "$dir/Anchor.toml")
    fi
    for account in "$dir"/tests/fixtures/accounts/*.json; do
      [ -e "$account" ] || continue
      echo "  $account"
      PRELOAD_ARGS+=(--account - "$account")
    done
  done
fi

# Start the MagicBlock stack: mb-stack boots the base validator (wraps
# solana-test-validator, pre-cloning MB programs), the ephemeral-validator, and the
# query-filtering-service (QFS) as one supervised process, in that order, gating
# each on its own health check before starting the next.
#
# Request flow for tests: client -> QFS (127.0.0.1:6699) -> ER validator
# (127.0.0.1:7799) -> solana validator (127.0.0.1:8899).
echo "Starting MagicBlock stack (mb-stack)..."
MB_STACK_BIN=$(command -v mb-stack 2>/dev/null)
if [ -z "$MB_STACK_BIN" ]; then
  echo "ERROR: 'mb-stack' not on PATH. Install with:"
  echo "  npm install -g @magicblock-labs/ephemeral-validator"
  exit 1
fi
echo "  Binary: $MB_STACK_BIN"
rm -rf ./magicblock-test-storage
RUST_LOG=info "$MB_STACK_BIN" --reset "${PRELOAD_ARGS[@]}" > ./mb-stack.log 2>&1 < /dev/null &

MB_STACK_PID=$!

# Wait for mb-stack to report all three services healthy. It gates each service on
# its own RPC health check internally (each with a 120s timeout), so give the
# overall wait enough headroom to cover base + ER + QFS coming up in sequence.
MB_STACK_READY_TIMEOUT="${MB_STACK_READY_TIMEOUT:-$([ "${ACT:-}" = "true" ] || [ "${GITHUB_ACTIONS:-}" = "true" ] && echo 240 || echo 180)}"
echo "Waiting for MagicBlock stack (base + ephemeral + QFS, up to ${MB_STACK_READY_TIMEOUT}s)..."
MB_STACK_READY=0
for ((i=1; i<=MB_STACK_READY_TIMEOUT; i++)); do
  if ! kill -0 "$MB_STACK_PID" 2>/dev/null; then
    echo "mb-stack exited before becoming ready."
    echo "Last 150 lines of ./mb-stack.log:"
    echo "----- mb-stack.log -----"
    tail -150 ./mb-stack.log 2>/dev/null || echo "(log file not found)"
    echo "----- end of log -----"
    exit 1
  fi
  if grep -q "MagicBlock stack is ready" ./mb-stack.log 2>/dev/null; then
    MB_STACK_READY=1
    break
  fi
  sleep 1
done
if [ "$MB_STACK_READY" != "1" ]; then
  echo "mb-stack failed to become ready within ${MB_STACK_READY_TIMEOUT}s."
  echo "Last 150 lines of ./mb-stack.log:"
  echo "----- mb-stack.log -----"
  tail -150 ./mb-stack.log 2>/dev/null || echo "(log file not found)"
  echo "----- end of log -----"
  exit 1
fi
cat ./mb-stack.log

# Start the VRF oracle.
echo "Starting VRF oracle..."
VRF_ORACLE_BIN=$(command -v vrf-oracle 2>/dev/null)
# Start the VRF oracle unless VRF tests are disabled.
if [ "${SKIP_VRF_TESTS:-0}" = "1" ]; then
  echo "Skipping VRF oracle startup (SKIP_VRF_TESTS=1)."
elif [ -z "$VRF_ORACLE_BIN" ]; then
  echo "ERROR: 'vrf-oracle' not on PATH — VRF-dependent tests will fail. Install it and re-run."
  exit 1
else
  echo "Starting VRF oracle..."
  VRF_ORACLE_BIN=$(command -v vrf-oracle 2>/dev/null)
  if [ -z "$VRF_ORACLE_BIN" ]; then
    echo "ERROR: 'vrf-oracle' not on PATH. Install it or set SKIP_VRF_TESTS=1."
    exit 1
  else
    echo "  Binary: $VRF_ORACLE_BIN"
    VRF_ORACLE_SKIP_PREFLIGHT="true" \
    RPC_URL="http://localhost:8899" \
    WEBSOCKET_URL="ws://localhost:8900" \
    RUST_LOG=info \
    "$VRF_ORACLE_BIN" > ./vrf-oracle.log 2>&1 < /dev/null &
    VRF_PID=$!
    # Brief readiness wait — the oracle subscribes to events; no port to probe,
    # so we just confirm the process is still alive after a moment.
    sleep 2
    if ! kill -0 $VRF_PID 2>/dev/null; then
      echo "VRF oracle died. Last 50 lines of ./vrf-oracle.log:"
      tail -50 ./vrf-oracle.log 2>/dev/null || true
      exit 1
    else
      echo "VRF oracle is running (PID $VRF_PID)."
    fi
    # ER VRF requests are fulfilled by a second oracle subscribed to the ephemeral validator.
    VRF_ORACLE_SKIP_PREFLIGHT="true" \
    RPC_URL="http://localhost:7799" \
    WEBSOCKET_URL="ws://localhost:7800" \
    RUST_LOG=info \
      "$VRF_ORACLE_BIN" > ./vrf-oracle-er.log 2>&1 < /dev/null &
    VRF_ER_PID=$!
    sleep 2
    if ! kill -0 $VRF_ER_PID 2>/dev/null; then
      echo "ER VRF oracle died. Last 50 lines of ./vrf-oracle-er.log:"
      tail -50 ./vrf-oracle-er.log 2>/dev/null || true
      exit 1
    else
      echo "ER VRF oracle is running (PID $VRF_ER_PID)."
    fi
  fi
fi

# Re-assert tty modes in case a validator's startup poked them.
stty sane </dev/tty 2>/dev/null || true

# SETUP_ONLY: bring the cluster up and hold it there for manual poking. The EXIT/INT
# trap (cleanup) tears the validators down once we return from the read.
if [ "${SETUP_ONLY:-0}" = "1" ]; then
  echo ""
  echo "========================================"
  echo "SETUP_ONLY: validators are up and running."
  echo "  Base Layer : ${PROVIDER_ENDPOINT:-http://localhost:8899}"
  echo "  ER         : ${EPHEMERAL_PROVIDER_ENDPOINT:-http://localhost:7799}"
  echo "  QFS        : ${QFS_ENDPOINT:-http://localhost:6699}"
  echo "========================================"
  echo "Press any key to stop the validators and exit..."
  # Read one key from the controlling tty (the test command pipeline may have
  # redirected this script's stdin), falling back to stdin if /dev/tty is absent.
  if [ -r /dev/tty ]; then
    read -rsn1 </dev/tty
  else
    read -rsn1
  fi
  echo ""
  exit 0
fi

echo "Validators ready. Running tests..."
echo ""

# MagicBlock validator identities (used as the `validator` arg when delegating):
#   Localnet:
#     Local ER (http://localhost:7799, fronted by   : mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev
#       the QFS at http://localhost:6699)
#   Devnet:
#     Asia (https://devnet-as.magicblock.app)     : MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57
#     EU   (https://devnet-eu.magicblock.app)     : MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e
#     US   (https://devnet-us.magicblock.app)     : MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd
#     TEE  (https://devnet-tee.magicblock.app)    : MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo

# ---- Local tests: base layer = local solana-test-validator; ER = query-filtering-service ----
# All localhost endpoints live in scripts/local-env.sh, the single source of truth
# shared with each example's `yarn test:local` (so a standalone test run targets the
# same local cluster instead of falling back to devnet). Exported here so every child
# test process sees them. The ER endpoint points at the local Query Filtering Service
# (QFS), which routes to the ephemeral validator (7799) and on to the base validator:
#   client -> QFS (6699) -> ER validator (7799) -> solana validator (8899)
# shellcheck source=scripts/local-env.sh
. "$SCRIPT_DIR/local-env.sh"

# ------------------------------------------------------------------------------
# Regular tests
# ------------------------------------------------------------------------------
if [ "${SKIP_REGULAR_TESTS:-0}" = "1" ]; then
  echo "Skipping regular local tests (SKIP_REGULAR_TESTS=1)."
else
  # Each project's `test:local` runs only the local subset of its tests (skipping
  # router/TEE/devnet variants). oncurve-delegation is omitted pending an SDK update.
  for project in "${REGULAR_PROJECTS[@]}"; do
    run_test "$project"
  done
fi

# ------------------------------------------------------------------------------
# VRF tests
# ------------------------------------------------------------------------------
if [ "${SKIP_VRF_TESTS:-0}" = "1" ]; then
  echo "Skipping VRF tests (SKIP_VRF_TESTS=1)."
else
  # VRF integration: roll-dice's delegated test reads VALIDATOR → defaults to the
  # local-ER validator since EPHEMERAL_PROVIDER_ENDPOINT is localhost.
  for project in "${VRF_PROJECTS[@]}"; do
    run_test "$project"
  done
fi

# ------------------------------------------------------------------------------
# TEE tests
# ------------------------------------------------------------------------------
if [ "${SKIP_TEE_TESTS:-0}" = "1" ]; then
  echo "Skipping TEE tests (SKIP_TEE_TESTS=1)."
else
  # TEE examples reach the ER through the QFS — run_test exposes TEE_PROVIDER_ENDPOINT/
  # TEE_WS_ENDPOINT to these runs (see the TEE_PROJECTS case in run_test).
  for project in "${TEE_PROJECTS[@]}"; do
    run_test "$project"
  done
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

# Exit non-zero when any test failed so the CI job fails. cleanup() (EXIT trap)
# captures this status and re-exits with it after stopping the validators.
if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
  exit 1
fi
exit 0
