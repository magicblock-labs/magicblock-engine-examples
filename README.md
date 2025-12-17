# ⚡ MagicBlock Engine - Integration Examples

Scaling solution for performant, composable games and applications.

## ✨Overview

This repository contains examples of how delegate/undelegate accounts and run transactions in an Ephemeral Rollups.
Read more about Ephemeral Rollups [here](https://docs.magicblock.gg/EphemeralRollups/ephemeral_rollups).

> To view integrated demos for specific usecases, please look at [MagicBlock Starter Kits](https://github.com/magicblock-labs/starter-kits).

## 👷Examples

- [Anchor Counter](./anchor-counter/README.md) - A simple counter that can be incremented. Tests use the ts sdk to delegate/undelegate accounts and run transactions.
- [Rust Counter](./rust-counter/README.md) - A simple counter that can be incremented. Tests natively to delegate/undelegate accounts and run transactions.
- [Bolt Counter](./bolt-counter/README.md) - A simple counter that can be incremented. Tests use the bolt sdk to delegate/undelegate accounts and run transactions.
- [Crank Counter](./crank-counter/README.md) - A counter program with scheduled cranks for automatic execution using MagicBlock's crank system.
- [Dummy Token Transfer](./dummy-token-transfer/README.md) - A token transferer that can delegate and execute both on-chain and in the ephemeral rollup.
- [Magic Actions](./magic-actions/README.md) - Demonstrates using Magic Actions to execute base chain actions from an ephemeral rollup.

## 🚧 Under Testing 🚧

The Ephemeral Rollups are currently under testing. Reach out to us on [Discord](https://discord.com/invite/MBkdC3gxcv) to get access to the testing endpoint.
