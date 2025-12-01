#!/bin/bash
set -o monitor

SOLANA_PID=""
EPHEMERAL_PID=""
PASSED_TESTS=()
FAILED_TESTS=()
declare -A FAILED_TESTS_ERRORS

# Test runner function
run_test() {
  local test_name=$1
  local test_command=$2
  local test_log="/tmp/test_${test_name}.log"
  
  echo ""
  echo "========================================"
  echo "Testing: $test_name"
  echo "========================================"
  echo ""
  
  # Start test in background and monitor progress
  ( FORCE_COLOR=1 CARGO_TERM_COLOR=always NO_COLOR= eval "$test_command" ) > "$test_log" 2>&1 &
  local test_pid=$!
  
  # Handle interrupt signal to kill test
  trap "kill -TERM $test_pid 2>/dev/null; exit 1" INT TERM
  
  # Progress indicator spinner
  local spinner=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
  local spinner_idx=0
  local last_status=""
  
  # Monitor test progress
  while kill -0 $test_pid 2>/dev/null; do
    # Detect current action by checking log contents
    local current_status=""
    
    # Get the most recent meaningful line from log
    local last_line=$(tail -1 "$test_log" 2>/dev/null)
    
    if grep -q "Deploying program" "$test_log"; then
      local prog_name=$(grep "Deploying program" "$test_log" | tail -1 | sed 's/.*Deploying program "\([^"]*\)".*/\1/')
      current_status="Deploying $prog_name..."
    elif grep -q "Waiting for program" "$test_log"; then
      local prog_id=$(grep "Waiting for program" "$test_log" | tail -1 | sed 's/.*for program \([^ ]*\).*/\1/')
      current_status="Confirming $prog_id..."
    elif grep -q "Running.*ts-mocha\|Running.*vitest" "$test_log"; then
      current_status="Running tests..."
    elif grep -q "Resolving packages" "$test_log" && ! grep -q "success Already" "$test_log"; then
      current_status="Resolving dependencies..."
    elif grep -q "success Already" "$test_log" && ! grep -q "Running.*tests" "$test_log"; then
      current_status="Dependencies installed..."
    elif grep -q "Finished.*target" "$test_log"; then
      local finish_type=$(echo "$last_line" | sed 's/.*Finished \(.*\) target.*/\1/')
      current_status="Building ($finish_type)..."
    elif grep -q "Compiling\|Checking" "$test_log"; then
      local crate=$(echo "$last_line" | sed 's/.*Compiling \([^ ]*\).*/\1/' | sed 's/.*Checking \([^ ]*\).*/\1/')
      current_status="Building $crate..."
    else
      current_status="Preparing..."
    fi
    
    # Update status line (carriage return to overwrite)
    if [ "$current_status" != "$last_status" ]; then
      printf "\r  ${spinner[$spinner_idx]} $current_status                                    "
      last_status="$current_status"
    else
      # Just update spinner even if status unchanged
      printf "\r  ${spinner[$spinner_idx]} $current_status                                    "
    fi
    
    spinner_idx=$(( (spinner_idx + 1) % 10 ))
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
  printf "\r                                         \r"
  
  # If test failed, show all output; if passed, show only summary
  if [ "$test_failed" = true ]; then
    # Show full output on failure
    cat "$test_log"
  else
    # Show only stage completion markers on success
    local stages_completed=""
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
    if [ -n "$stages_completed" ]; then
      echo "  $stages_completed"
    fi
  fi
  
  # Check if test actually failed by looking for failure indicators
  # Check for mocha test failures (X failing)
  if grep -q "[0-9] failing" "$test_log"; then
    FAILED_TESTS+=("$test_name")
    
    # Extract test failures section - get from first failure number onwards
    local error_details=$(tail -600 "$test_log" | sed -n '/^  [0-9]\+)/,$p' | head -300)
    
    if [ -z "$error_details" ]; then
      # Fallback: get the whole end of log
      error_details=$(tail -400 "$test_log")
    fi
    
    FAILED_TESTS_ERRORS["$test_name"]="$error_details"
  # Check for compile errors
  elif grep -q "error\[" "$test_log" || grep -q "could not compile" "$test_log"; then
    FAILED_TESTS+=("$test_name")
    
    # Extract compilation error details
    local error_details=$(grep -B 2 -A 8 "error\[" "$test_log" | head -60)
    if [ -z "$error_details" ]; then
      error_details=$(grep -B 3 -A 5 "could not compile" "$test_log" | head -60)
    fi
    
    FAILED_TESTS_ERRORS["$test_name"]="$error_details"
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
  echo ""
  echo "Stopping validators..."
  
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
  
  wait 2>/dev/null || true
  echo "Validators stopped."
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
  --accounts-lifecycle ephemeral \
  --remote-cluster development \
  --remote-url http://localhost:8899 \
  --remote-ws-url ws://localhost:8900 \
  --rpc-port 7799 > ./ephemeral-validator.log 2>&1 &

EPHEMERAL_PID=$!

echo "Validators ready. Running tests..."
echo ""

# run_test "anchor-counter" "cd anchor-counter && anchor build && anchor deploy --provider.cluster localnet && yarn install && EPHEMERAL_PROVIDER_ENDPOINT='http://localhost:7799' EPHEMERAL_WS_ENDPOINT='ws://localhost:7800' PROVIDER_ENDPOINT=http://localhost:8899 WS_ENDPOINT=http://localhost:8900 anchor test --provider.cluster localnet --skip-local-validator --skip-deploy; cd .."

run_test "anchor-minter" "cd anchor-minter && anchor build && anchor deploy --provider.cluster localnet && yarn install && anchor test --skip-deploy; cd .."

run_test "anchor-rock-paper-scissor" "cd anchor-rock-paper-scissor && anchor build && yarn install && anchor test --skip-deploy; cd .."

run_test "dummy-token-transfer" "cd dummy-token-transfer && yarn install && EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799 EPHEMERAL_WS_ENDPOINT=ws://localhost:7800 PROVIDER_ENDPOINT=http://localhost:8899 WS_ENDPOINT=http://localhost:8900 anchor test; cd .."

run_test "magic-actions" "cd magic-actions && yarn install && anchor build && yarn install && anchor test --skip-deploy; cd .."

# run_test "oncurve-delegation" "cd oncurve-delegation && yarn install && yarn test && yarn test-web3js; cd .."

# run_test "roll-dice" "cd roll-dice && yarn install && EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799 EPHEMERAL_WS_ENDPOINT=ws://localhost:7800 PROVIDER_ENDPOINT=http://localhost:8899 WS_ENDPOINT=http://localhost:8900 anchor test; cd .."

# run_test "rust-counter" "cd rust-counter && yarn install && EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799 EPHEMERAL_WS_ENDPOINT=ws://localhost:7800 PROVIDER_ENDPOINT=http://localhost:8899 WS_ENDPOINT=http://localhost:8900 yarn test; cd .."

# run_test "session-keys" "cd session-keys && yarn install && anchor build && yarn install && anchor test --skip-deploy; cd .."

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
  for test in "${FAILED_TESTS[@]}"; do
    echo "--- $test ---"
    echo "${FAILED_TESTS_ERRORS[$test]}"
    echo ""
  done
fi
