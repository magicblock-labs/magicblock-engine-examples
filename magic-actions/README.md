# ✨ Magic Actions

Demonstrates using Magic Actions to execute automatic on-chain handlers when committing accounts from Ephemeral Rollups to the base layer.

## Software Packages

This program has utilized the following software packages.

| Software   | Version | Installation Guide                                              |
| ---------- | ------- | --------------------------------------------------------------- |
| **Solana** | 3.1.9   | [Install Solana](https://docs.anza.xyz/cli/install)             |
| **Rust**   | 1.89.0  | [Install Rust](https://www.rust-lang.org/tools/install)         |
| **Anchor** | 1.0.2   | [Install Anchor](https://www.anchor-lang.com/docs/installation) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)          |

```sh
# Check and initialize your Solana version
agave-install list
agave-install init 3.1.9

# Check and initialize your Rust version
rustup show
rustup install 1.89.0

# Check and initialize your Anchor version
avm list
avm use 1.0.2
```

## Build and Test

Run the tests with existing program:

```bash
anchor test --skip-deploy --skip-build --skip-local-validator
```

Build, deploy and run the tests with new program (note: delete keypairs in `/target/deploy` folder):

```bash
# Delete keypairs in the deploy folder
rm -rf /target/deploy/*.keypair

# Build, deploy and test program
anchor test
```
