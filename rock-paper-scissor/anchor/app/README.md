# Rock Paper Scissors — Frontend

A playful web UI for the [confidential Rock Paper Scissors program](../README.md), showing off MagicBlock Ephemeral Rollups + TEE permissions:

- 🤖 **Solo mode** — play against a robot that locks in its own secret on-chain choice
- 👥 **Two-player mode** — share a link or QR code; a friend joins from any device and the winner is revealed the instant the last move lands
- 🥇 **Best-of-N matches** — choose Single / Best of 3 / Best of 5 at creation. Rounds replay on the same PDAs, the score is tracked on-chain, tied rounds replay, and the **match winner** takes the pot
- 💰 **Wagering** — set a SOL stake when creating a game (default `0.1`, or free play). Both players stake into an on-chain vault, and the **match winner claims the pot** at settle
- 🔒 Choices live in **private TEE accounts** on the ephemeral rollup — the opponent (and the RPC) cannot read them until the program flips the permissions public at reveal
- ⚙️ An "Under the hood" activity log narrates every step: create + delegate on Solana, TEE permission setup, encrypted moves on the ER, reveal, payout, and the final commit + undelegate back to the base layer

No wallet extension needed — the app plays from a burner keypair stored in `localStorage` (the same pattern as the `roll-dice` example app). Connect a wallet (Phantom, Solflare, …) to **top up** the burner or **withdraw** your winnings back out.

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
| `create_game(game_id, stake)` (stakes P1) + `delegate_pda(choice)` | Solana | host |
| `init_permission(choice, [host])` | ER (TEE) | host |
| `join_game` (stakes P2) + `delegate_pda(game)` + `delegate_pda(choice)` | Solana | joiner |
| `init_permission(game, [p1, p2])` + `init_permission(choice, [joiner])` | ER (TEE) | joiner |
| `make_choice` | ER (TEE) | both, privately |
| `reveal_winner` (simulated first, sent when both choices exist) | ER | whoever's client notices first |
| `reset_game` (auto between rounds → next round; "Rematch" on free games → new match) | ER | either player |
| `undelegate_all` + `claim_pot` ("Settle & claim pot" button) | ER → Solana | either player |

A match runs round-by-round on the ER: after each reveal the app shows the round result and score, then auto-advances (`reset_game`) to the next round on the same PDAs — tied rounds replay. When a player reaches the win target the match is over. Both stakes are escrowed in a per-game **vault PDA** on the base layer; "Settle & claim pot" undelegates and calls `claim_pot` to pay the **match winner**. In **solo mode** the app fronts the robot's stake and sweeps its balance back to you afterward, so you can never lose to your own robot.

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
| `VITE_TOPUP_ENDPOINT` | devnet | RPC the wallet top-up/withdraw submits through — the wallet derives its target chain from this URL, so it defaults to devnet and never silently spends mainnet SOL |

The default wager, match length, and presets live in `src/lib/config.ts` (`DEFAULT_STAKE_SOL`, `STAKE_PRESETS_SOL`, `DEFAULT_BEST_OF`, `BEST_OF_PRESETS`).

For the **local cluster** (`yarn setup` in the parent directory), use the local block in `.env.example` (base `:8899`, QFS `:6699`, validator `mAGicPQ…`). On **mainnet** the TEE lives at `https://mainnet-tee.magicblock.app`.

The IDL is copied from `../target/idl` on every `yarn dev` / `yarn build` (best-effort), so rebuild the program first if you change it: `cd .. && yarn build`.

After a reveal: **free games** offer **Rematch ⚡** (replays on the same PDAs with only ER transactions — no new rent; the other client auto-detects the reset) or **Settle to Solana 🏁**. **Wagered games** show **Settle & claim pot 💰**, which settles and pays the winner — each wager is one decisive game.

## Tips

- **Withdraw your winnings**: the **Withdraw 🏧** button (top right) cashes the burner's balance out to a connected wallet, keeping a little back for fees.
- **Try both sides on one machine**: open your own invite link in the same browser — the app detects it and plays the second seat from a separate "guest" burner key (auto-funded from the host burner when possible).
- **Resume**: the game id lives in the URL (`?game=<id>`), so reloading mid-game picks up where you left off.
