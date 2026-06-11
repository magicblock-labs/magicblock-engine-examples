# 🔒 Pinocchio Private Counter

Pinocchio counter variant that exercises private state on the Ephemeral Rollup.

This is a port of the Rust Counter program to use Pinocchio instead of Borsh for serialization, eliminating the need for Vec types. It demonstrates confidential counter state on a MagicBlock TEE without the Anchor framework.

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

`yarn setup` runs `SETUP_ONLY=1 ./test-locally.sh pinocchio-private-counter` from the repo root: it builds this example, boots the validators, and holds them until you press a key.

Then, in a second terminal, run this example's tests against that cluster:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster (without it the tests fall back to devnet).

> Tip: to build and run **every** example end-to-end (what CI does), run the repo-root `./test-locally.sh` directly.

This is a TEE (Trusted Execution Environment) example: locally, ER calls route through the QFS via the `TEE_*` endpoints. The full devnet/TEE path additionally requires a funded devnet keypair, so in CI these tests are skipped unless a `DEVNET_KEYPAIR_JSON` secret is set (the repo sets `SKIP_TEE_TESTS=1` without it).

## Key Differences from Rust Counter

- **No Borsh**: Uses manual serialization with `to_le_bytes()` and `from_le_bytes()` for simplicity
- **No Vec**: All types use fixed-size arrays or primitives
- **Pinocchio Framework**: Leverages Pinocchio's lightweight instruction handling
- **Direct State Management**: Simple `Counter` struct with manual serialization

## Instructions

### 0: InitializeCounter
Initialize a counter PDA to 0. Payload: `bump` (u8).

### 1: IncreaseCounter
Increase the counter by a specified amount. Payload: `bump` (u8) + `increase_by` (u64).

### 2: Delegate
Delegate the counter account to the Ephemeral Rollups delegation program. Payload: `bump` (u8).

### 3: CommitAndUndelegate
Commit changes and undelegate the counter account.

### 4: Commit
Commit changes to the base layer.

### 5: IncrementAndCommit
Increment counter and commit in one instruction. Payload: `bump` (u8) + `increase_by` (u64).

### 6: IncrementAndUndelegate
Increment counter and undelegate in one instruction. Payload: `bump` (u8) + `increase_by` (u64).

## Account Structure

- **Counter**: 8 bytes (u64 count value)
