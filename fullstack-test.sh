#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

run_clean_output() {
  FORCE_COLOR=1 \
  CLICOLOR_FORCE=1 \
  TERM=xterm-256color \
  CARGO_TERM_COLOR=always \
  "$@" 2>&1 | sed -u 's/\r/\n/g'
  return ${PIPESTATUS[0]}
}

is_truthy() {
  case "$1" in
    [Yy]|[Yy][Ee][Ss]|[Tt][Rr][Uu][Ee]|[Oo][Nn]|1)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

has_ancestor_flag() {
  local needle=$1
  local pid=$$
  local ppid
  local cmd
  local depth=0

  while [ -n "$pid" ] && [ "$pid" -ne 1 ] && [ "$depth" -lt 20 ]; do
    cmd="$(ps -p "$pid" -o args= -ww 2>/dev/null | tr '\n' ' ')"
    if echo "$cmd" | grep -q -- "$needle"; then
      return 0
    fi

    ppid="$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ')"
    if [ -z "$ppid" ] || [ "$ppid" = "$pid" ]; then
      break
    fi
    pid="$ppid"
    depth=$((depth + 1))
  done

  return 1
}

has_anchor_cli_skip_local_validator() {
  if pgrep -af "anchor" 2>/dev/null | awk '($0 ~ /test/) && ($0 ~ /--skip-local-validator/) { found=1; exit } END { exit (found?0:1) }'; then
    return 0
  fi
  return 1
}

airdrop_upgrade_authority() {
  local cluster_url=$1
  local keypair=${2:-"${HOME}/.config/solana/id.json"}
  local authority

  if [ ! -f "$keypair" ]; then
    echo -e "${RED}Error: Upgrade authority keypair not found at ${keypair}${NC}"
    return 1
  fi

  authority="$(solana address -k "$keypair")"
  echo -e "${YELLOW}Airdropping 100 SOL to upgrade authority (${authority}) on ${cluster_url}...${NC}"
  run_clean_output solana airdrop 100 "$authority" --url "$cluster_url" --keypair "$keypair"
}

MB_VALIDATOR_STARTED_BY_US=false
EPHEMERAL_VALIDATOR_STARTED_BY_US=false

SKIP_LOCAL_VALIDATOR=false
for arg in "$@"; do
  if [ "$arg" = "--skip-local-validator" ]; then
    SKIP_LOCAL_VALIDATOR=true
    break
  fi
done

if is_truthy "${SKIP_LOCAL_VALIDATOR}" || is_truthy "${ANCHOR_SKIP_LOCAL_VALIDATOR}" || has_ancestor_flag "--skip-local-validator" || has_anchor_cli_skip_local_validator; then
  SKIP_LOCAL_VALIDATOR=true
fi

# Check if a port is in use
check_port() {
  local port=$1
  if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
    return 0  # Port is in use
  else
    return 1  # Port is not in use
  fi
}

# Check cluster from Anchor.toml
ANCHOR_TOML="Anchor.toml"
if [ ! -f "$ANCHOR_TOML" ]; then
  echo -e "${RED}Error: Anchor.toml not found${NC}"
  exit 1
fi

CLUSTER=$(grep -A 1 "^\[provider\]" "$ANCHOR_TOML" | grep "cluster" | sed 's/.*cluster = "\(.*\)".*/\1/' | tr -d ' ')
if [ -z "$CLUSTER" ]; then
  echo -e "${RED}Error: Could not determine cluster from Anchor.toml${NC}"
  exit 1
fi

echo -e "${GREEN}Detected Cluster: ${CLUSTER}${NC}"

# Cleanup function
cleanup() {
  if [ "$CLUSTER" = "localnet" ]; then
    # Only cleanup validators if we started them
    if [ "$MB_VALIDATOR_STARTED_BY_US" = true ] || [ "$EPHEMERAL_VALIDATOR_STARTED_BY_US" = true ]; then
      echo -e "\n[SETUP] ${YELLOW}Cleaning up validators...${NC}"
      if ! is_truthy "$SKIP_LOCAL_VALIDATOR"; then
        if [ "$MB_VALIDATOR_STARTED_BY_US" = true ] && [ ! -z "$MB_VALIDATOR_PID" ]; then
          kill $MB_VALIDATOR_PID 2>/dev/null || true
        fi
        if [ "$EPHEMERAL_VALIDATOR_STARTED_BY_US" = true ] && [ ! -z "$EPHEMERAL_VALIDATOR_PID" ]; then
          kill $EPHEMERAL_VALIDATOR_PID 2>/dev/null || true
        fi
        # Kill any remaining validator processes (only if we started them)
        if [ "$MB_VALIDATOR_STARTED_BY_US" = true ]; then
          pkill -f "solana-test-validator" 2>/dev/null || true
          pkill -f "mb-test-validator" 2>/dev/null || true
        fi
        if [ "$EPHEMERAL_VALIDATOR_STARTED_BY_US" = true ]; then
          pkill -f "ephemeral-validator" 2>/dev/null || true
        fi
      else
        echo -e "\n[SETUP] ${GREEN}Skip-local-validator mode: leaving validator processes untouched...${NC}"
      fi
      # Clean up test ledger directories (only if we started the validators)
      if [ "$MB_VALIDATOR_STARTED_BY_US" = true ] && ! is_truthy "$SKIP_LOCAL_VALIDATOR"; then
        echo -e "${YELLOW}Cleaning up test ledger directories...${NC}"
        rm -rf test-ledger 2>/dev/null || true
        rm -rf test-ledger-magicblock 2>/dev/null || true
      fi
      if [ "$EPHEMERAL_VALIDATOR_STARTED_BY_US" = true ]; then
        rm -rf magicblock-test-storage 2>/dev/null || true
      fi
      echo -e "${GREEN}Cleanup complete${NC}"
    else
      echo -e "\n[SETUP] ${GREEN}Validators were already running, leaving them running...${NC}"
    fi
  fi
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

if [ "$CLUSTER" = "localnet" ]; then
  # Check if anchor started its own validator (port 8899 occupied but not by mb-test-validator)
  if ! is_truthy "$SKIP_LOCAL_VALIDATOR"; then
    if check_port 8899 && ! pgrep -f "mb-test-validator" > /dev/null 2>&1; then
      echo -e "${YELLOW}Non-MagicBlock validator detected on port 8899, killing it...${NC}"
      echo -e "${YELLOW}Tip: run with 'anchor test --skip-local-validator --skip-build --skip-deploy' to avoid this${NC}"
      lsof -ti :8899 | xargs kill 2>/dev/null
      sleep 1
    fi
  fi

  # Check if ephemeral-validator is installed
  if ! command -v ephemeral-validator &> /dev/null; then
    echo -e "${RED}Error: ephemeral-validator is not installed${NC}"
    echo "Install it with: npm install -g @magicblock-labs/ephemeral-validator@latest"
    exit 1
  fi

  # Set solana config to localhost
  solana config set --url localhost 2>/dev/null

  # Check if mb-test-validator (Solana validator) is already running on port 8899
  if is_truthy "$SKIP_LOCAL_VALIDATOR"; then
    if check_port 8899; then
      echo -e "[SETUP] ${GREEN}skip-local-validator enabled, using existing validator on port 8899...${NC}"
      MB_VALIDATOR_PID=$(lsof -ti :8899 | head -1)
    else
      echo -e "[SETUP] ${YELLOW}skip-local-validator is enabled, but no validator detected on port 8899...${NC}"
      echo -e "${RED}Unable to run with --skip-local-validator: no validator available on port 8899.${NC}"
      exit 1
    fi
  elif check_port 8899; then
    echo -e "[SETUP] ${GREEN}Solana validator is already running on port 8899, skipping startup...${NC}"
    MB_VALIDATOR_STARTED_BY_US=false
    # Try to get the PID of the running validator
    MB_VALIDATOR_PID=$(lsof -ti :8899 | head -1)
  else
    echo -e "[SETUP] ${GREEN}Starting mb-test-validator...${NC}"
    mb-test-validator --reset > /tmp/mb-test-validator.log 2>&1 &
    MB_VALIDATOR_PID=$!
    MB_VALIDATOR_STARTED_BY_US=true

    # Wait for solana-test-validator to be ready
    echo -e "${YELLOW}Waiting for solana-test-validator to be ready...${NC}"
    for i in {1..60}; do
      if curl -s http://127.0.0.1:8899/health > /dev/null 2>&1; then
        echo -e "${GREEN}solana-test-validator is ready${NC}"
        break
      fi
      if [ $i -eq 60 ]; then
        echo -e "${RED}Error: solana-test-validator failed to start${NC}"
        echo "Check logs at /tmp/mb-test-validator.log"
        exit 1
      fi
      sleep 1
    done
  fi

  # Check if ephemeral-validator is already running on port 7799
  if check_port 7799; then
    echo -e "[SETUP] ${GREEN}Ephemeral validator is already running on port 7799, skipping startup...${NC}"
    EPHEMERAL_VALIDATOR_STARTED_BY_US=false
    # Try to get the PID of the running validator
    EPHEMERAL_VALIDATOR_PID=$(lsof -ti :7799 | head -1)
  else
    # Start ephemeral-validator
    echo -e "[SETUP] ${GREEN}Starting ephemeral-validator...${NC}"
    RUST_LOG=info ephemeral-validator \
      --remotes "http://127.0.0.1:8899" \
      --remotes "ws://127.0.0.1:8900" \
      -l "127.0.0.1:7799" \
      --reset \
      > /tmp/ephemeral-validator.log 2>&1 &
    EPHEMERAL_VALIDATOR_PID=$!
    EPHEMERAL_VALIDATOR_STARTED_BY_US=true

    # Wait for ephemeral-validator to be ready
    echo -e "${YELLOW}Waiting for ephemeral-validator to be ready...${NC}"
    for i in {1..60}; do
      if curl -s http://127.0.0.1:7799/health > /dev/null 2>&1; then
        echo -e "${GREEN}ephemeral-validator is ready${NC}"
        break
      fi
      if [ $i -eq 60 ]; then
        echo -e "${RED}Error: ephemeral-validator failed to start${NC}"
        echo "Check logs at /tmp/ephemeral-validator.log"
        exit 1
      fi
      sleep 1
    done
  fi

  export EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799
  export EPHEMERAL_WS_ENDPOINT=ws://localhost:7800
  export ANCHOR_WALLET="${HOME}/.config/solana/id.json"
  export ANCHOR_PROVIDER_URL="http://127.0.0.1:8899"

  airdrop_upgrade_authority "$ANCHOR_PROVIDER_URL" "$ANCHOR_WALLET"

  echo -e "${GREEN}Running anchor test...${NC}"
  run_clean_output anchor build
  run_clean_output anchor deploy --provider.cluster localnet

  run_clean_output yarn ts-mocha --colors -p ./tsconfig.json -t 1000000 --exit tests/**/*.ts --provider.cluster localnet --skip-local-validator --skip-build --skip-deploy
  TEST_EXIT_CODE=$?
  
  if [ $TEST_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}Tests failed with exit code ${TEST_EXIT_CODE}${NC}"
    exit $TEST_EXIT_CODE
  fi
  echo -e "${GREEN}Tests completed successfully${NC}"
else
  # For devnet or other clusters, run tests directly (anchor has already built/deployed)
  echo -e "${GREEN}Running tests for ${CLUSTER}...${NC}"
  export ANCHOR_WALLET="${HOME}/.config/solana/id.json"
  
  # Derive ANCHOR_PROVIDER_URL from CLUSTER
  case "$CLUSTER" in
    localnet)
      export ANCHOR_PROVIDER_URL="http://127.0.0.1:8899"
      ;;
    devnet)
      export ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
      ;;
    mainnet)
      export ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com"
      ;;
    *)
      echo -e "${RED}Error: Unknown cluster '${CLUSTER}'. Please specify a valid ANCHOR_PROVIDER_URL${NC}"
      exit 1
      ;;
  esac
  
  run_clean_output yarn run ts-mocha --colors -p ./tsconfig.json -t 1000000 tests/**/*.ts
  TEST_EXIT_CODE=$?
  
  if [ $TEST_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}Tests failed with exit code ${TEST_EXIT_CODE}${NC}"
    exit $TEST_EXIT_CODE
  fi
  echo -e "${GREEN}Tests completed successfully${NC}"
fi
