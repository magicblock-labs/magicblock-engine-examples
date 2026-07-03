# Binary Prediction

Anchor example for a binary up/down prediction flow on MagicBlock Ephemeral Rollups.

The example shows a user staking SPL tokens on a directional price move. The program reads a
MagicBlock `ephemeral-oracle` price feed on the ER, snapshots the opening price at bet time, and
settles against the same feed after a short per-bet expiry. Correct calls pay the pool's configured
payout multiplier; ties refund the stake; incorrect calls lose the stake to the pool.

This is an illustrative feature example, not a production risk engine. The pool is an unhedged
counterparty, and the example intentionally keeps liquidity accounting simple.

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

## Lifecycle

```text
initialize
  creates Pool PDA config + pool-authority ATA, stores mint/feed/authority/config
  seeds LP liquidity, deposits it into the e-token vault, and delegates the pool-authority EATA

approve + place_bet
  user approves Pool PDA as SPL delegate once
  pool authority approves Pool PDA as SPL delegate once
  session signer calls place_bet on the ER
  program reads oracle price, checks pool liquidity, opens Bet, and pulls stake

settle
  program reads oracle price after expiry
  up/down/tie outcome pays the configured multiplier, keeps stake, or refunds stake
  Bet is reset for reuse

user undelegate + withdraw
  user token custody returns to the base layer
```

## Build and Test

Install dependencies and build the program:

```bash
yarn
yarn build
```

This example runs against a local MagicBlock cluster: a base Solana validator, an Ephemeral Rollup,
and the Query Filtering Service. Start it in one terminal and leave it running:

```bash
yarn setup
```

Then, in a second terminal, run the lifecycle test:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster. The test uses a
vendored `--features test-mode` `ephemeral_oracle.so` fixture, so prices are deterministic and seeded
by the test wallet.

## Client

The `app/` directory contains a small Vite client for exercising the local binary prediction flow.
Run the local MagicBlock cluster first:

```bash
yarn setup
```

Then start the client in another terminal:

```bash
cd app
yarn
yarn dev
```

The client defaults to `http://localhost:8899` for the base layer and `http://localhost:7799` for
the ER. Override with `VITE_PROVIDER_ENDPOINT`, `VITE_EPHEMERAL_PROVIDER_ENDPOINT`, and
`VITE_EPHEMERAL_WS_ENDPOINT` when needed.

## Instruction Surface

- `initialize(price_feed, price_feed_id, seed_amount, bet_duration_seconds, min_stake, payout_bps)`
  — create the singleton pool, store market config, seed LP liquidity, and delegate pool token
  custody.
- `place_bet(direction, stake)` — session-authorized ER instruction that reads the feed and opens a
  per-user bet.
- `settle()` — settle one open bet against the current feed price.
- `undelegate_bet()` — optional Bet account undelegation path for users who want to reclaim account
  rent after finishing with the example.

## Notes

- `place_bet` is session-authorized, but SPL Token does not understand session tokens. The user signs
  a one-time SPL `approve` that makes the Pool PDA a token delegate over their ER token account.
- The Pool account is initialized once and is not delegated. Pool token custody is owned by a real
  `poolAuthority` signer; its EATA is delegated during `initialize` and is intentionally not
  undelegated by this example. The Pool PDA is only the SPL token delegate used by program-signed
  transfers.
- Payout math is integer `stake * pool.payout_bps / 10_000`; `payout_bps` is configured when the
  pool is initialized.
- One open `Bet` per user is supported. The account is reset in place after settlement.
- Future production-oriented extensions include shared pooled rounds, multi-market support, crank
  auto-settlement, richer risk controls, and a Flash API liquidity variant.
