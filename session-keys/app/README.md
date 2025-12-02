# Ephemeral Counter UI

This is a React-based UI for the Ephemeral Counter program, which is part of the documentation for integrating with the Ephemeral Rollups.

## Overview

The UI demonstrates the use of Solana's ephemeral rollups with a simple counter program. It showcases an `increment` instruction that can run both on the main network and ephemeral rollup.

## Documentation

For more information, visit: [Ephemeral Rollups Documentation](https://docs.magicblock.gg/Accelerate/ephemeral_rollups).

## Getting Started

### Prerequisites

- Node.js
- npm

### Installation

1. Navigate to the `app` directory
2. Install the dependencies:
   

    npm install
   

### Running the Application

To start the application, run:


    npm run dev


### Configure RPC endpoints

This UI talks to two RPC endpoints:
- REACT_APP_PROVIDER_ENDPOINT: the Solana RPC used by the wallet and on-chain counter (e.g., your local validator or a public RPC).
- REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT: the Ephemeral Rollup RPC used for the ephemeral counter.

You can set them via environment variables when starting the app.

Examples
- Using localhost (same machine):
    REACT_APP_PROVIDER_ENDPOINT=http://localhost:8899 \
    REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799 \
    npm run start

If these variables are not provided, the app will default to MagicBlock’s public endpoints:
- REACT_APP_PROVIDER_ENDPOINT → https://rpc.magicblock.app/devnet
- REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT → https://devnet.magicblock.app

