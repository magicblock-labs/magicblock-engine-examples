# On-Curve Delegation

Example test suite for delegating on-curve accounts to the MagicBlock Ephemeral Rollups system and managing their delegation lifecycle.

## Overview

This project demonstrates how to delegate Solana on-curve accounts (such as system program-owned accounts) to the Ephemeral Rollups (ER) system. Once delegated, accounts can execute transactions within the ER environment with lower latency and costs.

## Test Structure

There is no on-chain program here: the example builds the delegation instructions client-side.

- **`tests-magicsvm-rs/tests/magicsvm.rs`**: Rust suite that runs the full lifecycle on
  [MagicSVM](https://github.com/magicblock-labs/magicsvm)

## Software Packages

| Software   | Version | Installation Guide                                      |
| ---------- | ------- | ------------------------------------------------------- |
| **Solana** | 3.1.9   | [Install Solana](https://docs.anza.xyz/cli/install)     |
| **Rust**   | stable  | [Install Rust](https://www.rust-lang.org/tools/install) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)  |

## Build and Test

There is no program to build, so `yarn build` is a no-op. Run the Rust test suite in `tests-magicsvm-rs/` in-process with [MagicSVM](https://github.com/magicblock-labs/magicsvm):

```bash
yarn test
```

MagicSVM simulates the base layer and the Ephemeral Rollup in one process: no validators, no
network. The suite assigns and delegates an on-curve account, commits its state, and undelegates it.

`yarn test` runs `cargo +stable test` on that suite.

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
