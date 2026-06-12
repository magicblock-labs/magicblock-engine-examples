# Rock Paper Scissors — Frontend

A playful web UI for the [confidential Rock Paper Scissors program](../README.md), showing off MagicBlock Ephemeral Rollups + TEE permissions:

- 🤖 **Solo mode** — play against a robot that locks in its own secret on-chain choice
- 👥 **Two-player mode** — share a link or QR code; a friend joins from any device and the winner is revealed the instant the last move lands
- 🔒 Choices live in **private TEE accounts** on the ephemeral rollup — the opponent (and the RPC) cannot read them until the program flips the permissions public at reveal
- ⚙️ An "Under the hood" activity log narrates every step: create + delegate on Solana, TEE permission setup, encrypted moves on the ER, reveal, and the final commit + undelegate back to the base layer

No wallet extension needed — the app plays from a burner keypair stored in `localStorage` (the same pattern as the `roll-dice` example app).

## Run it

```bash
yarn
yarn dev
```

`yarn dev` serves with `--host`, so the QR code works for phones on the same network.

By default the app targets **devnet** (`rpc.magicblock.app/devnet`) and the devnet **MagicBlock TEE** (`devnet-tee.magicblock.app`), using the program id from the bundled IDL. The first time you play, the app asks you to fund the burner wallet — use the in-app airdrop button or [faucet.solana.com](https://faucet.solana.com).

## Game flow (what the app actually does)

| Step | Layer | Who |
| --- | --- | --- |
| `create_game` + `delegate_pda(choice)` | Solana | host |
| `init_permission(choice, [host])` | ER (TEE) | host |
| `join_game` + `delegate_pda(game)` + `delegate_pda(choice)` | Solana | joiner |
| `init_permission(game, [p1, p2])` + `init_permission(choice, [joiner])` | ER (TEE) | joiner |
| `make_choice` | ER (TEE) | both, privately |
| `reveal_winner` (simulated first, sent when both choices exist) | ER | whoever's client notices first |
| `reset_game` ("Rematch" button — clears the round, re-privatizes permissions, same PDAs) | ER | either player |
| `undelegate_all` ("Settle to Solana" button — commit + undelegate game and both choices) | ER → Solana | either player |

After a player makes their move, their client polls the ER: it simulates `reveal_winner` and only sends it once the simulation succeeds — i.e. the moment the **last** choice lands. The other client picks the result up from the game account.

Both clients read the game account through their own TEE auth token (`getAuthToken` signed by the burner key). Opponent choice accounts return `null` until the program flips their permissions public during reveal — that's the confidentiality demo.

## Configuration

Copy `.env.example` to `.env.local` to override anything:

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_PROGRAM_ID` | address in `src/idl/*.json` | Program id |
| `VITE_BASE_ENDPOINT` | `https://rpc.magicblock.app/devnet` | Base layer RPC |
| `VITE_TEE_ENDPOINT` | `https://devnet-tee.magicblock.app` | TEE ER RPC |
| `VITE_TEE_WS_ENDPOINT` | derived from TEE endpoint | TEE ER websocket |
| `VITE_VALIDATOR` | `MTEW…3xzo` | ER validator to delegate to |
| `VITE_TOPUP_ENDPOINT` | devnet | RPC the wallet top-up submits through — the wallet derives its target chain from this URL, so it defaults to devnet and never silently spends mainnet SOL |

For the **local cluster** (`yarn setup` in the parent directory), use the local block in `.env.example` (base `:8899`, QFS `:6699`, validator `mAGicPQ…`). On **mainnet** the TEE lives at `https://mainnet-tee.magicblock.app`.

The IDL is copied from `../target/idl` on every `yarn dev` / `yarn build` (best-effort), so rebuild the program first if you change it: `cd .. && yarn build`.

After a reveal you can either **Rematch ⚡** — `reset_game` clears the round and flips the permissions back to private, so the next round replays on the same PDAs with nothing but ER transactions (no new accounts, no new rent) — or **Settle to Solana 🏁** to commit and undelegate everything back to the base layer. When one player hits Rematch, the other client detects the reset and returns to the picker automatically.

## Tips

- **Try both sides on one machine**: open your own invite link in the same browser — the app detects it and plays the second seat from a separate "guest" burner key (auto-funded from the host burner when possible).
- **Resume**: the game id lives in the URL (`?game=<id>`), so reloading mid-game picks up where you left off.
