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

## Frontend

A playable web UI lives in [`app/`](app/README.md) — solo mode against a robot, plus a two-player mode where a friend joins via link or QR code and the winner reveals the instant the last move lands:

```bash
cd app && yarn && yarn dev
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

`yarn setup` runs `SETUP_ONLY=1 ./scripts/test-locally.sh rock-paper-scissor` from the repo root: it builds this example, boots the validators, and holds them until you press a key.

Then, in a second terminal, run this example's tests against that cluster:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster (without it the tests fall back to devnet).

> Tip: to build and run **every** example end-to-end (what CI does), run the repo-root `./scripts/test-locally.sh` directly.

This is a TEE (Trusted Execution Environment) example: locally, ER calls route through the QFS via the `TEE_*` endpoints. The full devnet/TEE path additionally requires a funded devnet keypair, so in CI these tests are skipped unless a `DEVNET_KEYPAIR_JSON` secret is set (the repo sets `SKIP_TEE_TESTS=1` without it).

## Usage

### Game Flow

1. **Player 1 creates a match** with a unique game ID, a best-of-N length, and a SOL wager (or free play)
2. **Player 2 joins** the same game and matches the wager
3. **Both players make hidden choices** (Rock, Paper, or Scissors)
4. **Choices are encrypted** in the ephemeral rollup
5. **Round winner is revealed** and the score updated (tied rounds replay)
6. **Next round** plays on the same PDAs until a player reaches the win target — all on the ER
7. **Results are finalized** on-chain and the **match winner claims the pot**

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

### Matches (best-of-N)

A game is a **match** of best-of-N rounds, set at creation via `target_wins` (round-wins needed; `1` = single round, `2` = best of 3, `3` = best of 5):

- `reveal_winner` decides each round and tallies `player1_wins` / `player2_wins`. A **tied round counts for neither side and is replayed**, so a match always resolves to a winner.
- While the match is undecided, `reset_game` **advances to the next round** on the same PDAs, keeping the score (re-privatizes the choice accounts). Once the match is decided, `reset_game` on a *free* game starts a brand-new match (score reset); a staked match must be settled + claimed first.
- `undelegate_all` is gated on the **match** being decided (not just a round), so the game can't be pulled back to the base layer mid-match.

### Wagering

Games can carry a SOL wager (default `0.1`, customizable at creation; `0` for free play):

- **Player 1 stakes** at `create_game`, **Player 2 stakes the same amount** at `join_game` — both deposits go into a per-game **vault PDA** (`["vault", game_id]`), a system-owned SOL escrow that is never delegated, so the pot stays put on the base layer while the match runs on the ER.
- After the match is decided and undelegated, `claim_pot` pays the **match winner the whole pot**. It is idempotent (`paid` flag) and the funds can only go to the two recorded players.
- `cancel_game` refunds the creator if no one ever joins.

### Program Accounts

- **Game Account**: Stores game state, current-round result, match score (`target_wins`/`player1_wins`/`player2_wins`/`round`), stake, and payout flag
- **PlayerChoice Account**: Stores a player's encrypted choice (PDAs)
- **Permission Account**: Controls access to encrypted data
- **Vault Account**: System-owned PDA escrow holding the pot

### Anchor Instructions

- `create_game` - Initialize a match, set the wager and best-of length (`create_game(game_id, stake, target_wins)`)
- `join_game` - Add the second player and match the wager
- `make_choice` - Submit encrypted choice
- `create_permission` - Setup access control
- `delegate_pda` - Delegate PDA to TEE validator
- `reveal_winner` - Decide the round and tally the match score
- `reset_game` - Advance to the next round (score kept), or start a fresh match once decided (free games); same PDAs, no new rent
- `undelegate_all` - Commit + undelegate game and both choices back to the base layer (only once the match is decided)
- `claim_pot` - Pay the match winner from the vault (base layer, after undelegate)
- `cancel_game` - Refund the creator if nobody joined

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROVIDER_ENDPOINT` | `https://rpc.magicblock.app/devnet` | Base layer RPC endpoint |
| `TEE_PROVIDER_ENDPOINT` | `https://devnet-tee.magicblock.app` | TEE ephemeral rollup RPC endpoint |
| `TEE_WS_ENDPOINT` | `wss://devnet-tee.magicblock.app` | WebSocket endpoint for subscriptions |
| `VALIDATOR` | `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` | TEE ER validator to delegate to |

On mainnet the TEE endpoints are `https://mainnet-tee.magicblock.app` / `wss://mainnet-tee.magicblock.app`. `scripts/local-env.sh` overrides all of these to target the local cluster.

## References

- [Anchor Documentation](https://www.anchor-lang.com/)
- [Solana Documentation](https://docs.solana.com/)
- [MagicBlock Ephemeral Rollups SDK](https://github.com/magicblock-labs/ephemeral-rollups-sdk)
- [Solana Web3.js](https://github.com/solana-labs/solana-web3.js)
