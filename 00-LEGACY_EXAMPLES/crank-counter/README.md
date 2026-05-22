# ⚙️ Crank Counter

Simple counter program using Anchor and Ephemeral Rollups with scheduled cranks for automatic execution.

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
anchor test --skip-deploy --skip-build --skip-local-validator
```

Build, deploy and run the tests with new program (note: delete keypairs in `/target/deploy` folder):

```bash
# Delete keypairs in the deploy folder
rm -rf /target/deploy/*.keypair

# Build, deploy and test program
anchor test
```

## 🏠 Running Tests with a Local Ephemeral Rollup

> For more detailed local setup instructions, check out the [MagicBlock Local Development Guide](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/local-development).

To run tests using a local ephemeral validator, follow these steps:

### 1. Start the Solana Test Validator

Start a Solana test validator with MagicBlock accounts preloaded:

```bash
mb-test-validator --reset
```

### 2. Start the MagicBlock Validator

Clone and run the [MagicBlock Validator](https://github.com/magicblock-labs/magicblock-validator):

```bash
RUST_LOG=debug cargo run -- --remote http://localhost:8899 --listen 127.0.0.1:7799
```

### 3. Set Environment Variables

Configure the environment variables for local development:

```bash
export EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799
export EPHEMERAL_WS_ENDPOINT=ws://localhost:7800
export ANCHOR_WALLET="${HOME}/.config/solana/id.json"
export ANCHOR_PROVIDER_URL="http://127.0.0.1:8899"
```

### 4. Deploy the Program

Build and deploy the crank program to localnet:

```bash
anchor build && anchor deploy --provider.cluster localnet
```

### 5. Run Tests

Execute the tests with the local setup:

```bash
anchor test --skip-deploy --skip-local-validator --skip-build
```
