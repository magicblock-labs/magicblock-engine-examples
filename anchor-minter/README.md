# ➕ Anchor Minter Program

Simple token minter program mints tokens while reading delegated counter account state.

## Software Packages

This program has utilized the following sofware packages.

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

Run the tests with existing program:

```bash
yarn
anchor test --skip-deploy --skip-build --skip-local-validator
```

Build, deploy and run the tests with new program (note: delete keypairs in `/target/deploy` folder):

```bash
# Delete keypairs in the deploy folder
rm -rf /target/deploy/*.keypair

# Build, deploy and test program
anchor test
```
