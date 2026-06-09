# 🎲 Pinocchio Roll Dice

Simple dice rolling application using Ephemeral Rollups to demonstrate using a verifiable random function (VRF) to generate random numbers.

# Demo

<img width="508" alt="Screenshot 2025-03-27 at 18 48 50" src="https://github.com/user-attachments/assets/8b67fd33-c9b4-48f1-9a1a-92a9e8d74111" />

[https://roll-dice-demo.vercel.app/](https://roll-dice-demo.vercel.app//)

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

## ✨ Build and Test

Build the program:

```bash
anchor build
```

Run the tests:

```bash
anchor test --skip-deploy --skip-build --skip-local-validator
```

## 🚀 Launch the Frontend

To start the frontend application locally:

```bash
cd roll-dice/app
```

Install dependencies:

```bash
yarn install
```

Start the development server:

```bash
yarn dev
```

The application will be available at `http://localhost:3000` (or another port if 3000 is already in use).
The delegated dice demo will be available at `http://localhost:3000/delegated`.
