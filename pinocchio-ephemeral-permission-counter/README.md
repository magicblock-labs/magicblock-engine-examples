# Pinocchio Ephemeral Permission Counter

A minimal Solana counter program built with [Pinocchio](https://github.com/anza-xyz/pinocchio) and MagicBlock Ephemeral Rollups. The example shows how to initialize a counter PDA, delegate it to an Ephemeral Rollup, protect it with ephemeral permissions, and commit the final state back to the base layer.

The program is `no_std`, does not use Borsh, and keeps account data in a fixed-size `Counter` struct.

## Requirements

| Software | Version | Installation Guide |
| -------- | ------- | ------------------ |
| Solana CLI | 2.3.13 | [Install Solana](https://docs.anza.xyz/cli/install) |
| Rust | 1.85.0 | [Install Rust](https://www.rust-lang.org/tools/install) |
| Node.js | 24.10.0 | [Install Node](https://nodejs.org/en/download/current) |
| Yarn | 4.x | [Install Yarn](https://yarnpkg.com/getting-started/install) |

## Setup

Install the TypeScript test dependencies:

```bash
yarn install
```

The tests read `PRIVATE_KEY` from the environment, or fall back to `~/.config/solana/id.json`.

```bash
cp .env.example .env
```

Optional RPC overrides:

- `PROVIDER_ENDPOINT`
- `WS_ENDPOINT`
- `EPHEMERAL_PROVIDER_ENDPOINT`
- `EPHEMERAL_WS_ENDPOINT`

## Build

```bash
yarn build
```

This runs:

```bash
cargo build-sbf
```

## Test

Run the Vitest integration flow:

```bash
yarn test
```

The test initializes the counter on Solana devnet, delegates it to the Ephemeral Rollup, increments it on both layers, creates/updates/closes a permission account, and commits the delegated state back to Solana.

## Program Model

The counter PDA is derived with:

```text
["counter", id]
```

where `id` is a 32-byte client-provided public key. The account stores:

| Field | Size | Description |
| ----- | ---- | ----------- |
| `id` | 32 bytes | Identifier used in the PDA seeds |
| `count` | 8 bytes | Little-endian `u64` counter value |
| `bump` | 1 byte | PDA bump |
| `_pad` | 7 bytes | Alignment padding |

Total size: 48 bytes.

## Instructions

Each instruction starts with an 8-byte little-endian discriminator.

| Discriminator | Instruction | Payload | Description |
| ------------- | ----------- | ------- | ----------- |
| `0` | `InitializeCounter` | `id` (`[u8; 32]`) | Creates the counter PDA and initializes `count` to `0`. |
| `1` | `IncreaseCounter` | `increase_by` (`u64`) | Adds `increase_by` to the counter with overflow checking. |
| `2` | `Delegate` | None | Delegates the counter PDA to the Ephemeral Rollups delegation program. |
| `3` | `CommitAndUndelegate` | None | Commits the counter state and undelegates it back to the base layer. |
| `4` | `CreatePermission` | None | Creates a private ephemeral permission for the counter. |
| `5` | `UpdatePermission` | None | Updates the counter permission membership. |
| `6` | `ClosePermission` | None | Closes the counter permission account. |

The delegation program also invokes the undelegation callback discriminator:

```text
[196, 28, 41, 206, 48, 37, 51, 167]
```
