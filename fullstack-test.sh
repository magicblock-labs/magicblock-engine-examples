#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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
    echo -ne "\n[SETUP] ${YELLOW}Cleaning up validators...${NC}\r"
    if [ ! -z "$MB_VALIDATOR_PID" ]; then
      kill $MB_VALIDATOR_PID 2>/dev/null || true
    fi
    if [ ! -z "$EPHEMERAL_VALIDATOR_PID" ]; then
      kill $EPHEMERAL_VALIDATOR_PID 2>/dev/null || true
    fi
    # Kill any remaining validator processes
    pkill -f "solana-test-validator" 2>/dev/null || true
    pkill -f "ephemeral-validator" 2>/dev/null || true
    # Clean up test ledger directories
    echo -ne "${YELLOW}Cleaning up test ledger directories...${NC}\r"
    rm -rf test-ledger 2>/dev/null || true
    rm -rf test-ledger-magicblock 2>/dev/null || true
    echo -e "\033[2K${GREEN}Cleanup complete${NC}"
  fi
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

if [ "$CLUSTER" = "localnet" ]; then
  # Check if ephemeral-validator is installed
  if ! command -v ephemeral-validator &> /dev/null; then
    echo -e "${RED}Error: ephemeral-validator is not installed${NC}"
    echo "Install it with: npm install -g @magicblock-labs/ephemeral-validator@latest"
    exit 1
  fi

  # Kill any existing validators that might be running
  echo -ne "[SETUP] ${YELLOW}Cleaning existing validators...${NC}\r"
  pkill -f "mb-test-validator" 2>/dev/null || true
  pkill -f "ephemeral-validator" 2>/dev/null || true
  pkill -f "solana-test-validator" 2>/dev/null || true
  sleep 2

  echo -ne "[SETUP] ${GREEN}Starting mb-test-validator...${NC}\r"
  mb-test-validator --reset > /tmp/mb-test-validator.log 2>&1 &
  MB_VALIDATOR_PID=$!

  # Set solana config to localhost
  solana config set --url localhost

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

  # Start ephemeral-validator
  echo -ne "[SETUP] ${GREEN}Starting ephemeral-validator...${NC}\r"
  RUST_LOG=info ephemeral-validator \
    --accounts-lifecycle ephemeral \
    --remote-cluster development \
    --remote-url http://127.0.0.1:8899 \
    --remote-ws-url ws://127.0.0.1:8900 \
    --rpc-port 7799 \
    > /tmp/ephemeral-validator.log 2>&1 &
  EPHEMERAL_VALIDATOR_PID=$!

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

  export EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799
  export EPHEMERAL_WS_ENDPOINT=ws://localhost:7800
  export ANCHOR_WALLET="${HOME}/.config/solana/id.json"
  export ANCHOR_PROVIDER_URL="http://127.0.0.1:8899"
  echo -e "${GREEN}Running anchor test...${NC}"
  anchor build && anchor deploy \
  --provider.cluster localnet
  EPHEMERAL_PROVIDER_ENDPOINT="http://localhost:7799" \
  EPHEMERAL_WS_ENDPOINT="ws://localhost:7800" \
  yarn ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts \
  --provider.cluster localnet \
  --skip-local-validator \
  --skip-build \
  --skip-deploy
else
  # For devnet or other clusters, run tests directly (anchor has already built/deployed)
  echo -e "${GREEN}Running tests for ${CLUSTER}...${NC}"
  export ANCHOR_WALLET="${HOME}/.config/solana/id.json"
  export ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
  yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
fi

echo -ne "${GREEN}Tests completed${NC}"

