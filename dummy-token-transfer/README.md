# 💸 Dummy Token Transfer

Demo program for implementing a token transfer that can delegate and execute both on-chain and in the ephemeral rollup.

## Software Packages

This program has utilized the following software packages.

| Software   | Version | Installation Guide                                              |
| ---------- | ------- | --------------------------------------------------------------- |
| **Solana** | 3.1.9   | [Install Solana](https://docs.anza.xyz/cli/install)             |
| **Rust**   | 1.89.0  | [Install Rust](https://www.rust-lang.org/tools/install)         |
| **Anchor** | 1.0.2   | [Install Anchor](https://www.anchor-lang.com/docs/installation) |
| **Node**   | 22.17.0 | [Install Node](https://nodejs.org/en/download/current)          |

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

## Running Tests on Devnet

To run tests on the devnet, use the following command:

```bash
anchor test --skip-local-validator --skip-build --skip-deploy
```

> **⚠️ Note:** Make sure you have devnet SOL in your local wallet.

## Running tests with a Local Ephemeral Rollup and Devnet

To run tests using a local ephemeral validator, follow these steps:

### 1. Install the Local Validator

Ensure you have the ephemeral validator installed globally:

```bash
npm install -g @magicblock-labs/ephemeral-validator
```

### 2. Start the Local Validator

Run the local validator with the appropriate environment variables:

```bash
ACCOUNTS_REMOTE=https://rpc.magicblock.app/devnet ACCOUNTS_LIFECYCLE=ephemeral ephemeral-validator
```

`ACCOUNTS_REMOTE` point to the reference RPC endpoint, and `ACCOUNTS_LIFECYCLE` should be set to `ephemeral`.

### 3. Run the Tests with the Local Validator

Execute the tests while pointing to the local validator:

```bash
PROVIDER_ENDPOINT=http://localhost:8899 WS_ENDPOINT=ws://localhost:8900 anchor test --skip-build --skip-deploy --skip-local-validator
```

This setup ensures tests run efficiently on a local ephemeral rollup while connecting to the devnet.
