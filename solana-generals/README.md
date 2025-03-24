
# MagicBlock Engine Example

This repository contains an example for a fully featured game running 100% serverless using Solana's devnet and MagicBlock's devnet.

Demo available [here](https://magicblock-labs.github.io/solana-generals/#/)

# Demo

Run the frontend that should already be pointing to solana's devnet:

```bash
cd backend
bolt build
cd ../frontend
npm install
npm run dev
```

You can then head to: https://faucet.solana.com/ to get some devnet SOL you can use to fund your player's account to start testing.

# Code organization

## Backend

The `backend` folder contains all smart contract code, it uses MagicBlock's BOLT.

The smart contracts should already be deployed on devnet.

You can also locally run the integration tests:

```bash
cd backend
bolt test
```

Some of the important code pieces are:

- `backend/programs-ecs/components` - Contains the definition for the game datastructure
- `backend/programs-ecs/systems` - Contains all possible game mutations available
- `backend/tests` - Integration tests and example on how the game can be used

## Frontend

The `frontend` folder contains an implementation for a React based web UI to interact with the smart contracts.

Some of the important pieces of code are:

- `frontend/src/states` - Utility functions to interact with the smart contract
- `frontend/src/components/menu` - Wallet manipulation code (including session keys)
- `frontend/src/components/page` - High level components for each page of the application

Reading some of those will help with the overall understanding of the architechture
