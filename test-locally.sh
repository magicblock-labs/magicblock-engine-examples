#!/bin/bash
set -o monitor

# Suppress job control messages
set +m

SOLANA_PID=""
EPHEMERAL_PID=""
SOLANA_STARTED_BY_US=false
EPHEMERAL_STARTED_BY_US=false
PASSED_TESTS=()
FAILED_TESTS=()
FAILED_TESTS_NAMES=()
FAILED_TESTS_ERRORS=()
TEST_COUNT=0

# Check if a port is in use
check_port() {
  local port=$1
  if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
    return 0  # Port is in use
  else
    return 1  # Port is not in use
  fi
}

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
  local status_start_time=$SECONDS
  local stage_times=""
  
  # Monitor test progress
  while kill -0 $test_pid 2>/dev/null; do
    # Detect current action by checking log contents
    local current_status=""
    
    # Get the most recent meaningful line from log
    local last_line=$(tail -1 "$test_log" 2>/dev/null)
    
    if grep -q "Deploying program" "$test_log"; then
      local prog_name=$(grep "Deploying program" "$test_log" | tail -1 | sed 's/.*Deploying program "\([^"]*\)".*/\1/')
      current_status="Deploying $prog_name"
    elif grep -q "Waiting for program" "$test_log"; then
      local prog_id=$(grep "Waiting for program" "$test_log" | tail -1 | sed 's/.*for program \([^ ]*\).*/\1/')
      current_status="Confirming $prog_id"
    elif grep -q "Running test suite\|Running.*ts-mocha\|Running.*vitest\|ts-mocha.*tests" "$test_log"; then
      current_status="Running tests"
    elif grep -q " RUN  v" "$test_log"; then
      current_status="Running tests"
    elif grep -q "passing\|failing" "$test_log"; then
      current_status="Running tests"
    elif grep -q "Resolving packages" "$test_log" && ! grep -q "success Already" "$test_log"; then
      current_status="Resolving dependencies"
    elif grep -q "success Already" "$test_log" && ! grep -q "Running.*tests" "$test_log"; then
      current_status="Dependencies installed"
    elif grep -q "Finished.*target" "$test_log"; then
      current_status="Building"
    elif grep -q "Compiling\|Checking" "$test_log"; then
      local crate=$(echo "$last_line" | sed 's/.*Compiling \([^ ]*\).*/\1/' | sed 's/.*Checking \([^ ]*\).*/\1/')
      current_status="Building $crate"
    else
      current_status="Preparing"
    fi
    
    # Update status line (carriage return to overwrite)
    if [ "$current_status" != "$last_status" ]; then
      # Record time for previous status if it's a main stage
      if [ -n "$last_status" ]; then
        case "$last_status" in
          Building*|*Building)
            local elapsed=$((SECONDS - status_start_time))
            stage_times+="Building:$elapsed "
            ;;
          Deploying*|*Deploying)
            local elapsed=$((SECONDS - status_start_time))
            stage_times+="Deploying:$elapsed "
            ;;
          Installing*|*Installing|*Resolving*|*Dependencies*)
            local elapsed=$((SECONDS - status_start_time))
            stage_times+="Installing:$elapsed "
            ;;
          Running*|*tests*|*Testing*)
            local elapsed=$((SECONDS - status_start_time))
            stage_times+="Testing:$elapsed "
            ;;
        esac
      fi
      status_start_time=$SECONDS
      echo -ne "\r  ${spinner[$spinner_idx]} $current_status${dots[$dots_idx]}                                    "
      last_status="$current_status"
    else
      # Update with current elapsed time for the running stage
      local current_elapsed=$((SECONDS - status_start_time))
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
  
  # Record final status time if it's a main stage
  if [ -n "$last_status" ]; then
    case "$last_status" in
      Building*|*Building)
        local elapsed=$((SECONDS - status_start_time))
        stage_times+="Building:$elapsed "
        ;;
      Deploying*|*Deploying)
        local elapsed=$((SECONDS - status_start_time))
        stage_times+="Deploying:$elapsed "
        ;;
      Installing*|*Installing|*Resolving*|*Dependencies*)
        local elapsed=$((SECONDS - status_start_time))
        stage_times+="Installing:$elapsed "
        ;;
      Running*|*tests*|*Testing*)
        local elapsed=$((SECONDS - status_start_time))
        stage_times+="Testing:$elapsed "
        ;;
    esac
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
    local error_details=$(tac "$test_log" | sed -n '/^  [0-9]\+)/,/^[[:space:]]*$/p' | tac)
    
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
  
  # Only stop validators if we started them
  if [ "$SOLANA_STARTED_BY_US" = true ] || [ "$EPHEMERAL_STARTED_BY_US" = true ]; then
    echo -n "Stopping validators... "
    
    # Kill by PID if available and we started them
    if [ "$SOLANA_STARTED_BY_US" = true ] && [ -n "$SOLANA_PID" ]; then
      kill -TERM $SOLANA_PID 2>/dev/null || true
    fi
    if [ "$EPHEMERAL_STARTED_BY_US" = true ] && [ -n "$EPHEMERAL_PID" ]; then
      kill -TERM $EPHEMERAL_PID 2>/dev/null || true
    fi
    
    # Give them a moment to gracefully shutdown
    sleep 1
    
    # Force kill any remaining processes
    if [ "$SOLANA_STARTED_BY_US" = true ] && [ -n "$SOLANA_PID" ]; then
      kill -9 $SOLANA_PID 2>/dev/null || true
    fi
    if [ "$EPHEMERAL_STARTED_BY_US" = true ] && [ -n "$EPHEMERAL_PID" ]; then
      kill -9 $EPHEMERAL_PID 2>/dev/null || true
    fi
    
    # Also kill by process name as fallback (only if we started them)
    if [ "$SOLANA_STARTED_BY_US" = true ]; then
      pkill -f "solana-test-validator" 2>/dev/null || true
    fi
    if [ "$EPHEMERAL_STARTED_BY_US" = true ]; then
      pkill -f "ephemeral-validator" 2>/dev/null || true
    fi
    
    # Wait for background jobs silently
    { wait 2>/dev/null || true; } 2>/dev/null
    
    # Check if validators are actually stopped
    local should_check=false
    if [ "$SOLANA_STARTED_BY_US" = true ] && [ "$EPHEMERAL_STARTED_BY_US" = true ]; then
      should_check=true
    elif [ "$SOLANA_STARTED_BY_US" = true ]; then
      if ! pgrep -f "solana-test-validator" >/dev/null 2>&1; then
        echo "✓ Stopped"
      else
        echo "✗ Failed to stop"
      fi
      should_check=false
    elif [ "$EPHEMERAL_STARTED_BY_US" = true ]; then
      if ! pgrep -f "ephemeral-validator" >/dev/null 2>&1; then
        echo "✓ Stopped"
      else
        echo "✗ Failed to stop"
      fi
      should_check=false
    fi
    
    if [ "$should_check" = true ]; then
      if ! pgrep -f "solana-test-validator" >/dev/null 2>&1 && ! pgrep -f "ephemeral-validator" >/dev/null 2>&1; then
        echo "✓ Stopped"
      else
        echo "✗ Failed to stop"
      fi
    fi
  else
    echo "Validators were already running, leaving them running..."
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

# Check if Solana Test Validator is already running on port 8899
if check_port 8899; then
  echo "Solana Test Validator is already running on port 8899, skipping startup..."
  SOLANA_STARTED_BY_US=false
  # Try to get the PID of the running validator
  SOLANA_PID=$(lsof -ti :8899 | head -1)
else
  # Start Solana Test Validator
  echo "Starting Solana Test Validator..."
  solana-test-validator \
    --ledger ./test-ledger \
    --reset \
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
    --url https://api.devnet.solana.com > ./test-ledger.log 2>&1 &
  
  SOLANA_PID=$!
  SOLANA_STARTED_BY_US=true
  
  # Wait for validator to be ready
  echo "Waiting for Solana validator..."
  for i in {1..30}; do
    if solana cluster-version --url http://localhost:8899 >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  echo "Solana validator is ready, waiting for RPC to stabilize..."
fi

# Check if MagicBlock Ephemeral Validator is already running on port 7799
if check_port 7799; then
  echo "MagicBlock Ephemeral Validator is already running on port 7799, skipping startup..."
  EPHEMERAL_STARTED_BY_US=false
  # Try to get the PID of the running validator
  EPHEMERAL_PID=$(lsof -ti :7799 | head -1)
else
  # Start MagicBlock Ephemeral Validator
  echo "Starting MagicBlock Ephemeral Validator..."
  RUST_LOG=info ephemeral-validator \
    --accounts-lifecycle ephemeral \
    --remote-cluster development \
    --remote-url http://localhost:8899 \
    --remote-ws-url ws://localhost:8900 \
    --rpc-port 7799 > ./ephemeral-validator.log 2>&1 &
  
  EPHEMERAL_PID=$!
  EPHEMERAL_STARTED_BY_US=true
fi

echo "Validators ready. Running tests..."
echo ""

# run_test "anchor-counter" "cd anchor-counter && anchor build && anchor deploy --provider.cluster localnet && yarn install && EPHEMERAL_PROVIDER_ENDPOINT='http://localhost:7799' EPHEMERAL_WS_ENDPOINT='ws://localhost:7800' PROVIDER_ENDPOINT=http://localhost:8899 WS_ENDPOINT=http://localhost:8900 anchor test --provider.cluster localnet --skip-local-validator --skip-deploy; cd .."

run_test "anchor-minter" "cd anchor-minter && anchor build && anchor deploy --provider.cluster localnet && yarn install && anchor test  --skip-build --skip-deploy --skip-local-validator; cd .."

run_test "anchor-rock-paper-scissor" "cd anchor-rock-paper-scissor && anchor build && yarn install && anchor test --skip-deploy; cd .."

run_test "dummy-token-transfer" "cd dummy-token-transfer && anchor build && yarn install && anchor test --skip-build --skip-deploy --skip-local-validator; cd .."

run_test "magic-actions" "cd magic-actions && yarn install && anchor build && yarn install && anchor test --skip-build --skip-deploy --skip-local-validator; cd .."

run_test "oncurve-delegation" "cd oncurve-delegation && yarn install && EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799 EPHEMERAL_WS_ENDPOINT=ws://localhost:7800 PROVIDER_ENDPOINT=http://localhost:8899 WS_ENDPOINT=http://localhost:8900 yarn test && EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799 EPHEMERAL_WS_ENDPOINT=ws://localhost:7800 PROVIDER_ENDPOINT=http://localhost:8899 WS_ENDPOINT=http://localhost:8900 yarn test-web3js; cd .."

run_test "roll-dice + roll-dice-delegated" "cd roll-dice && anchor build && anchor deploy --provider.cluster localnet && yarn install && EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799 EPHEMERAL_WS_ENDPOINT=ws://localhost:7800 PROVIDER_ENDPOINT=http://localhost:8899 WS_ENDPOINT=http://localhost:8900 anchor test --skip-build --skip-deploy --skip-local-validator; cd .."

# run_test "rust-counter" "cd rust-counter && yarn install && EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799 EPHEMERAL_WS_ENDPOINT=ws://localhost:7800 PROVIDER_ENDPOINT=http://localhost:8899 WS_ENDPOINT=http://localhost:8900 yarn test; cd .."

run_test "session-keys" "cd session-keys && anchor build && yarn install && anchor test --skip-build --skip-deploy --skip-local-validator; cd .."

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
