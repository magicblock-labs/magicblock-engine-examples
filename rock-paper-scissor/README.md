# Anchor Rock Paper Scissor

A confidential Rock Paper Scissor game built on Solana using Anchor and MagicBlock's Ephemeral Rollups SDK. This example demonstrates how to implement a two-player game with hidden choices that remain private during gameplay until the winner is revealed.

## Overview

This project showcases:
- **Solana Smart Contract**: Built with Anchor framework
- **Confidentiality**: Player choices are hidden using MagicBlock's Ephemeral Rollups
- **On-chain Game Logic**: Automated winner determination with transparent results
- **Permission System**: Fine-grained access control via the ephemeral rollups SDK

## Software Packages

| Software   | Version | Installation Guide                                              |
| ---------- | ------- | --------------------------------------------------------------- |
| **Solana** | 3.1.9   | [Install Solana](https://docs.anza.xyz/cli/install)             |
| **Rust**   | 1.89.0  | [Install Rust](https://www.rust-lang.org/tools/install)         |
| **Anchor** | 1.0.2   | [Install Anchor](https://www.anchor-lang.com/docs/installation) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)          |

```sh
agave-install init 3.1.9
rustup install 1.89.0
avm use 1.0.2
```

## Build and Test

Install dependencies and build the program:

```bash
yarn
yarn build
```

This example runs against a **local MagicBlock cluster** — a base Solana validator plus an Ephemeral Rollup, fronted by the Query Filtering Service. Start it in one terminal and leave it running:

```bash
yarn setup
```

`yarn setup` runs `SETUP_ONLY=1 ./test-locally.sh rock-paper-scissor` from the repo root: it builds this example, boots the validators, and holds them until you press a key.

Then, in a second terminal, run this example's tests against that cluster:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster (without it the tests fall back to devnet).

> Tip: to build and run **every** example end-to-end (what CI does), run the repo-root `./test-locally.sh` directly.

This is a TEE (Trusted Execution Environment) example: locally, ER calls route through the QFS via the `TEE_*` endpoints. The full devnet/TEE path additionally requires a funded devnet keypair, so in CI these tests are skipped unless a `DEVNET_KEYPAIR_JSON` secret is set (the repo sets `SKIP_TEE_TESTS=1` without it).

## Usage

### Game Flow

1. **Player 1 creates a game** with a unique game ID
2. **Player 2 joins** the same game
3. **Both players make hidden choices** (Rock, Paper, or Scissors)
4. **Choices are encrypted** in the ephemeral rollup
5. **Winner is revealed** - game logic determines the winner
6. **Results are finalized** on-chain

### Example Test Output

```
Program ID: <program-address>
Game ID (u64): 1706309545000
...
✅ Game Created: <tx-hash>
✅ Player 2 joined game <id>: <tx-hash>
✅ Player 1 chose {"rock":{}}: <tx-hash>
✅ Player 2 chose {"paper":{}}: <tx-hash>
✅ Reveal Winner TX Sent: <tx-hash>
🎲 Game Result Account Data: {winner: 2, player1Choice: {...}, player2Choice: {...}}
```

## Key Concepts

### Ephemeral Rollups

Player choices are processed in MagicBlock's Ephemeral Rollups, which provides:
- **TEE Execution**: Encrypted execution environment
- **Privacy**: Other players cannot see choices until revealed
- **Finality**: Results are committed to Solana mainnet

### Program Accounts

- **Game Account**: Stores game state and result
- **PlayerChoice Account**: Stores a player's encrypted choice (PDAs)
- **Permission Account**: Controls access to encrypted data

### Anchor Instructions

- `create_game` - Initialize a new game
- `join_game` - Add the second player
- `make_choice` - Submit encrypted choice
- `create_permission` - Setup access control
- `delegate_pda` - Delegate PDA to TEE validator
- `reveal_winner` - Compute and store result

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EPHEMERAL_PROVIDER_ENDPOINT` | `https://tee.magicblock.app` | Ephemeral rollup RPC endpoint |
| `EPHEMERAL_WS_ENDPOINT` | `wss://tee.magicblock.app` | WebSocket endpoint for subscriptions |

## References

- [Anchor Documentation](https://www.anchor-lang.com/)
- [Solana Documentation](https://docs.solana.com/)
- [MagicBlock Ephemeral Rollups SDK](https://github.com/magicblock-labs/ephemeral-rollups-sdk)
- [Solana Web3.js](https://github.com/solana-labs/solana-web3.js)
