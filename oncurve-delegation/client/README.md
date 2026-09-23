# On-Curve Delegation

Example test suite for delegating on-curve accounts to the MagicBlock Ephemeral Rollups system and managing their delegation lifecycle.

## Overview

This project demonstrates how to delegate Solana on-curve accounts (such as system program-owned accounts) to the Ephemeral Rollups (ER) system. Once delegated, accounts can execute transactions within the ER environment with lower latency and costs.

## Test Structure

The project contains two test implementations:

- **`tests/kit/`**: Tests using the Solana Kit library
  - `oncurve-delegation.test.ts`: Main test suite using Solana Kit
  - `initializeKeypair.ts`: Helper functions for keypair initialization and management

- **`tests/web3js/`**: Tests using the web3.js library
  - `oncurve-delegation.test.ts`: Main test suite using web3.js
  - `initializeKeypair.ts`: Helper functions for keypair initialization and management

## Software Packages

| Software   | Version | Installation Guide                                      |
| ---------- | ------- | ------------------------------------------------------- |
| **Solana** | 3.1.9   | [Install Solana](https://docs.anza.xyz/cli/install)     |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)  |

## Build and Test

Install dependencies:

```bash
yarn
yarn build
```

This is an SDK-only integration example — there is no on-chain program here, so `yarn build` is a no-op.

Run the tests in-process with [MagicSVM](https://github.com/magicblock-labs/magicsvm):

```bash
yarn test
```

MagicSVM simulates the base layer and the Ephemeral Rollup in one process: no validators, no
network. The suite assigns and delegates an on-curve account, commits its state, and undelegates it.

A Rust MagicSVM suite lives in `tests-magicsvm-rs/` (needs a nightly toolchain): `yarn test:magicsvm:rs`.

```bash
yarn test:web3js
```

## Delegation Workflow

The test suite demonstrates the complete delegation lifecycle:

1. **Assign Owner + Delegate**: 
   - Changes the on-curve account's owner to the delegation program
   - Creates a delegation instruction to register the account with the ER system
   - Transactions are sent to the base layer

2. **Commit**: 
   - Commits account state from Ephemeral Rollups to the base layer
   - Ensures state consistency between ER and base layer

3. **Commit and Undelegate**: 
   - Commits the final state and undelegates the account in a single transaction
   - Restores the account to its original state

## Environment Variables

Configure these in your `.env` file:

```env
# Base Layer RPC Endpoints
PROVIDER_ENDPOINT=https://api.devnet.solana.com        # Base layer HTTP RPC
WS_ENDPOINT=wss://api.devnet.solana.com                # Base layer WebSocket

# Ephemeral Rollups RPC Endpoints
EPHEMERAL_PROVIDER_ENDPOINT=https://devnet-as.magicblock.app    # ER HTTP RPC
EPHEMERAL_WS_ENDPOINT=wss://devnet-as.magicblock.app            # ER WebSocket
```

## Dependencies

Key dependencies for this project:

- `@magicblock-labs/ephemeral-rollups-kit`: v0.14.3 - High-level SDK for ER interactions
- `@magicblock-labs/ephemeral-rollups-sdk`: v0.14.3 - Low-level ER SDK
- `@solana/kit`: v4.0.0 - Solana Kit library
- `@solana/web3.js`: v1.98.2 - Web3.js library
- `vitest`: v3.2.4 - Test runner

## Notes

- Tests use `vitest` for execution and are configured to run sequentially
- Default test timeout is 60 seconds per test
- Tests depend on previous state, so they must run in order
- Two RPC endpoints are required: one for the base layer and one for Ephemeral Rollups
