# SPL Tokens

Anchor example demonstrating SPL token delegation to Ephemeral Rollups:
create a mint, delegate token balances, transfer tokens on the ER, and settle
balances back to the base layer.

Includes a React UI in [`app/`](./app/README.md) for interactive demos.

This folder does **not** implement the Ephemeral SPL Token program itself. The
local test harness preloads that program at
`SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2` from
[`tests/fixtures/ephemeral_token_program.so`](./tests/fixtures/ephemeral_token_program.so).
The Anchor program in this folder is a small DLP-style example that runs on the
ER and CPIs into the token program once balances have been delegated.

## What This Shows

This example is the lightweight, Anchor-based token transfer walkthrough for
the fuller [`ephemeral-spl-token`](https://github.com/magicblock-labs/ephemeral-spl-token)
repository. Use this example when you want to understand the integration path
from an app or Anchor program; use `ephemeral-spl-token` when you need the
production program internals, shuttle flows, permissions, transfer queues, or
automation details.

The tests cover two common integration paths:

- SDK-driven flow: delegate SPL balances, transfer between delegated token
  accounts on the ER, undelegate, and withdraw the final balances back to base.
- Program-driven flow: delegate token accounts, then call this example's Anchor
  program on the ER to CPI into the SPL Token Program and transfer tokens.

## Flow

1. Create a fresh SPL mint and two associated token accounts on the base layer.
2. Mint test tokens to both owners.
3. Fund the rent sponsor PDA used by the ER SPL token helpers.
4. Delegate selected token balances to the Ephemeral Rollup.
5. Wait until the ER has cloned the delegated token accounts.
6. Transfer tokens on the ER through either the SDK helper or this Anchor
   program.
7. Undelegate and wait for the base-layer commitment signature.
8. Withdraw settled token balances back to the base-layer token accounts.

The example intentionally uses fresh mints and owners in tests so runs are
isolated and do not depend on shared devnet state.

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

`yarn setup` runs `SETUP_ONLY=1 ./scripts/test-locally.sh spl-tokens` from the repo root: it builds this example, boots the validators, and holds them until you press a key.

Then, in a second terminal, run this example's tests against that cluster:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster (without it the tests fall back to devnet).

> Tip: to build and run **every** example end-to-end (what CI does), run the repo-root `./scripts/test-locally.sh` directly.

## Key Files

- [`programs/spl-tokens/src/lib.rs`](./programs/spl-tokens/src/lib.rs) - small
  Anchor program that validates ownership/mint constraints and performs an SPL
  Token Program CPI on the ER.
- [`Anchor.toml`](./Anchor.toml) - preloads the Ephemeral SPL Token and DLP
  fixtures for local tests.
- [`tests/spl-tokens.ts`](./tests/spl-tokens.ts) - end-to-end setup,
  delegation, ER transfer, undelegation, and withdrawal coverage.
- [`tests/fixtures/`](./tests/fixtures/) - local validator fixtures for the
  delegation and ephemeral token programs used by the test harness.
- [`app/`](./app/README.md) - React UI for trying the flow interactively.

## Notes

- The tests use `delegateSpl`, `transferSpl`, `undelegateIx`, and `withdrawSpl`
  from `@magicblock-labs/ephemeral-rollups-sdk`.
- Delegation confirmation on the base layer can happen before the ER has cloned
  the token account. The test helper waits for the ER token account balance
  before submitting ER-side transfers.
- This example uses the legacy vault flow (`idempotent: false`) because it is
  paired with the undelegate and withdraw helpers used in the test.

## Launch the Frontend

```bash
cd app
yarn install
yarn dev
```

See [`app/README.md`](./app/README.md) for RPC endpoint configuration.
