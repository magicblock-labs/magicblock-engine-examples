# SPL Tokens Example UI

https://spl-demo.magicblock.app/

This React UI demonstrates SPL token delegation and transfers across Solana and
MagicBlock Ephemeral Rollups. It pairs with the `spl-tokens` Anchor program in
this repository.

## Overview

The UI follows the same model as the test suite:

- connect a wallet on the base layer,
- delegate token balances to the ER,
- submit low-latency token transfers on the ER,
- settle balances back to the base layer.

## Documentation

For more information, visit: [Ephemeral Rollups Documentation](https://docs.magicblock.gg/Accelerate/ephemeral_rollups).

## Getting Started

### Prerequisites

- Node.js
- Yarn

### Installation

1. Navigate to the `app` directory
2. Install the dependencies:

```bash
yarn install
```

### Running the Application

To start the application, run:

```bash
yarn dev
```

### Configure RPC endpoints

This UI talks to two RPC endpoints:
- REACT_APP_PROVIDER_ENDPOINT: the Solana RPC used by the wallet and base-layer token accounts.
- REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT: the Ephemeral Rollup RPC used for delegated token transfers.

You can set them via environment variables when starting the app.

Example using localhost:

```bash
    REACT_APP_PROVIDER_ENDPOINT=http://localhost:8899 \
    REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799 \
    yarn dev
```

If these variables are not provided, the app will default to MagicBlock’s public endpoints:
- REACT_APP_PROVIDER_ENDPOINT → https://rpc.magicblock.app/devnet
- REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT → https://devnet-as.magicblock.app
