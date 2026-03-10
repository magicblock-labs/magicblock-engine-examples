# ➕ Rewards with Delegated VRF

Rewards program using Anchor, VRF, and Ephemeral Rollups.

## Software Packages

This program has utilized the following software packages.

| Software   | Version | Installation Guide                                              |
| ---------- | ------- | --------------------------------------------------------------- |
| **Solana** | 2.3.13  | [Install Solana](https://docs.anza.xyz/cli/install)             |
| **Rust**   | 1.85.0  | [Install Rust](https://www.rust-lang.org/tools/install)         |
| **Anchor** | 0.32.1  | [Install Anchor](https://www.anchor-lang.com/docs/installation) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)          |

```sh
# Check and initialize your Solana version
agave-install list
agave-install init 2.3.13

# Check and initialize your Rust version
rustup show
rustup install 1.85.0

# Check and initialize your Anchor version
avm list
avm use 0.32.1
```

## ✨ Build and Test

The test script automatically detects the cluster from `Anchor.toml` and handles Ephemeral Rollup setup for localnet:

```bash
yarn
anchor build
anchor deploy
anchor test --skip-deploy --skip-build --skip-local-validator
```

Note: You may need to update program example program id and authority

```rust
declare_id!("HuGRGfqr7BNdeogipmidXL21PjF4qSoXFDaCBhetviwZ");
pub const PROGRAM_AUTHORITY: Pubkey = pubkey!("EyBRt4Acr7b4s3exfnVvJ4EgL8oa6Lc4JK1Leonud34W");
```
