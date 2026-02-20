#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

MB_VALIDATOR_STARTED_BY_US=false
EPHEMERAL_VALIDATOR_STARTED_BY_US=false

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
      echo -ne "\n[SETUP] ${YELLOW}Cleaning up validators...${NC}\r"
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
      # Clean up test ledger directories (only if we started the validators)
      if [ "$MB_VALIDATOR_STARTED_BY_US" = true ]; then
        echo -ne "${YELLOW}Cleaning up test ledger directories...${NC}\r"
        rm -rf test-ledger 2>/dev/null || true
        rm -rf test-ledger-magicblock 2>/dev/null || true
      fi
      if [ "$EPHEMERAL_VALIDATOR_STARTED_BY_US" = true ]; then
        rm -rf magicblock-test-storage 2>/dev/null || true
      fi
      echo -e "\033[2K${GREEN}Cleanup complete${NC}"
    else
      echo -e "\n[SETUP] ${GREEN}Validators were already running, leaving them running...${NC}"
    fi
  fi
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

if [ "$CLUSTER" = "localnet" ]; then
  # Check if anchor started its own validator (port 8899 occupied but not by mb-test-validator)
  if check_port 8899 && ! pgrep -f "mb-test-validator" > /dev/null 2>&1; then
    echo -e "${YELLOW}Non-MagicBlock validator detected on port 8899, killing it...${NC}"
    echo -e "${YELLOW}Tip: run with 'anchor test --skip-local-validator --skip-build --skip-deploy' to avoid this${NC}"
    lsof -ti :8899 | xargs kill 2>/dev/null
    sleep 1
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
  if check_port 8899; then
    echo -e "[SETUP] ${GREEN}Solana validator is already running on port 8899, skipping startup...${NC}"
    MB_VALIDATOR_STARTED_BY_US=false
    # Try to get the PID of the running validator
    MB_VALIDATOR_PID=$(lsof -ti :8899 | head -1)
  else
    echo -ne "[SETUP] ${GREEN}Starting mb-test-validator...${NC}\r"
    mb-test-validator --reset > /tmp/mb-test-validator.log 2>&1 &
    MB_VALIDATOR_PID=$!
    MB_VALIDATOR_STARTED_BY_US=true

    # Wait for solana-test-validator to be ready
    echo -ne "${YELLOW}Waiting for solana-test-validator to be ready...${NC}\r"
    for i in {1..60}; do
      if curl -s http://127.0.0.1:8899/health > /dev/null 2>&1; then
        echo -e "\033[2K${GREEN}solana-test-validator is ready${NC}"
        break
      fi
      if [ $i -eq 60 ]; then
        echo -e "\033[2K${RED}Error: solana-test-validator failed to start${NC}"
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
    echo -ne "[SETUP] ${GREEN}Starting ephemeral-validator...${NC}\r"
    RUST_LOG=info ephemeral-validator \
      --remotes "http://127.0.0.1:8899" \
      --remotes "ws://127.0.0.1:8900" \
      -l "127.0.0.1:7799" \
      --reset \
      > /tmp/ephemeral-validator.log 2>&1 &
    EPHEMERAL_VALIDATOR_PID=$!
    EPHEMERAL_VALIDATOR_STARTED_BY_US=true

    # Wait for ephemeral-validator to be ready
    echo -ne "${YELLOW}Waiting for ephemeral-validator to be ready...${NC}\r"
    for i in {1..60}; do
      if curl -s http://127.0.0.1:7799/health > /dev/null 2>&1; then
        echo -e "\033[2K${GREEN}ephemeral-validator is ready${NC}"
        break
      fi
      if [ $i -eq 60 ]; then
        echo -e "\033[2K${RED}Error: ephemeral-validator failed to start${NC}"
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
  echo -e "${GREEN}Running anchor test...${NC}"
  anchor build && anchor deploy --provider.cluster localnet
  
  yarn ts-mocha -p ./tsconfig.json -t 1000000 --exit tests/**/*.ts --provider.cluster localnet --skip-local-validator --skip-build --skip-deploy
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
  
  yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
  TEST_EXIT_CODE=$?
  
  if [ $TEST_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}Tests failed with exit code ${TEST_EXIT_CODE}${NC}"
    exit $TEST_EXIT_CODE
  fi
  echo -e "${GREEN}Tests completed successfully${NC}"
fi

