## SPL Tokens Example UI (Ephemeral Rollups)

A React UI that demonstrates SPL Token flows across Solana and MagicBlock Ephemeral Rollups. It pairs with the programs/spl-tokens on-chain program in this repository.

### What this UI shows
- Create or load a temporary SPL token mint (for demo purposes)
- Create Associated Token Accounts (ATAs) for users
- Mint demo tokens to accounts
- Delegate tokens to the Ephemeral Rollup chain
- Perform token transfers on the Ephemeral chain
- Undelegate and withdraw tokens back to Solana

---

## 🚀 Getting Started

### Prerequisites
- Node.js (18+ recommended)
- npm or yarn

### Install & run
From this folder (app/app):

Using npm
```
npm install
npm run start
```

Using yarn
```
yarn install
yarn start
```

The dev server will start on http://localhost:3000.

---

## ⚙️ Configure RPC endpoints
This UI talks to two RPC endpoints:
- REACT_APP_PROVIDER_ENDPOINT: Solana RPC (e.g., local validator or a public devnet RPC)
- REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT: Ephemeral Rollup RPC
- SETUP_MINT: existing SPL mint address to use instead of auto-creating one on startup
- SETUP_QUEUE_KEYPAIR: local filesystem path to a Solana `keypair.json`, embedded at startup and used only by the `Setup queue` and `Start queue crank` buttons
- REACT_APP_SETUP_QUEUE_KEYPAIR: fetchable path or URL alternative for the same queue-only signer override

You can set them via environment variables when starting the app. If not provided, the app defaults to MagicBlock public endpoints:
- REACT_APP_PROVIDER_ENDPOINT → https://rpc.magicblock.app/devnet
- REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT → https://devnet.magicblock.app

Use `SETUP_QUEUE_KEYPAIR=/absolute/path/to/keypair.json` for local development, or `REACT_APP_SETUP_QUEUE_KEYPAIR=/queue-keypair.json` if you want the browser to fetch it from `public/`.
