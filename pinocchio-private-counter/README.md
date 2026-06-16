# Pinocchio Ephemeral Permission Counter

A minimal Solana counter program built with [Pinocchio](https://github.com/anza-xyz/pinocchio) and MagicBlock Ephemeral Rollups. The example shows how to initialize a counter PDA, delegate it to an Ephemeral Rollup, protect it with ephemeral permissions, and commit the final state back to the base layer.

The program is `no_std`, does not use Borsh, and keeps account data in a fixed-size `Counter` struct.

## Software Packages

| Software   | Version | Installation Guide                                      |
| ---------- | ------- | ------------------------------------------------------- |
| **Solana** | 3.1.9   | [Install Solana](https://docs.anza.xyz/cli/install)     |
| **Rust**   | 1.89.0  | [Install Rust](https://www.rust-lang.org/tools/install) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)  |

```sh
agave-install init 3.1.9
rustup install 1.89.0
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

`yarn setup` runs `SETUP_ONLY=1 ./scripts/test-locally.sh pinocchio-ephemeral-permission-counter` from the repo root: it builds this example, boots the validators, and holds them until you press a key.

Then, in a second terminal, run this example's tests against that cluster:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster (without it the tests fall back to devnet). Use `yarn test:watch` to re-run the suite on file changes.

The test initializes the counter on the base layer, delegates it to the Ephemeral Rollup, increments it on both layers, creates/updates/closes a permission account, and commits the delegated state back to the base layer.

> Tip: to build and run **every** example end-to-end (what CI does), run the repo-root `./scripts/test-locally.sh` directly.

## Program Model

The counter PDA is derived with:

```text
["counter", id]
```

where `id` is a 32-byte client-provided public key. The account stores:

| Field   | Size     | Description                       |
| ------- | -------- | --------------------------------- |
| `id`    | 32 bytes | Identifier used in the PDA seeds  |
| `count` | 8 bytes  | Little-endian `u64` counter value |
| `bump`  | 1 byte   | PDA bump                          |
| `_pad`  | 7 bytes  | Alignment padding                 |

Total size: 48 bytes.

## Instructions

Each instruction starts with an 8-byte little-endian discriminator.

| Discriminator | Instruction           | Payload               | Description                                                            |
| ------------- | --------------------- | --------------------- | ---------------------------------------------------------------------- |
| `0`           | `InitializeCounter`   | `id` (`[u8; 32]`)     | Creates the counter PDA and initializes `count` to `0`.                |
| `1`           | `IncreaseCounter`     | `increase_by` (`u64`) | Adds `increase_by` to the counter with overflow checking.              |
| `2`           | `Delegate`            | None                  | Delegates the counter PDA to the Ephemeral Rollups delegation program. |
| `3`           | `CommitAndUndelegate` | None                  | Commits the counter state and undelegates it back to the base layer.   |
| `4`           | `CreatePermission`    | None                  | Creates a private ephemeral permission for the counter.                |
| `5`           | `UpdatePermission`    | None                  | Updates the counter permission membership.                             |
| `6`           | `ClosePermission`     | None                  | Closes the counter permission account.                                 |

The delegation program also invokes the undelegation callback discriminator:

```text
[196, 28, 41, 206, 48, 37, 51, 167]
```
