# ⚡ Magicblock Ephemeral Counter Client

A premium React web application demonstrating **Magicblock's Ephemeral Rollups (ER)** on Solana. This client integrates **Privy** for seamless passwordless authentication and embedded wallet creation, allowing users to interact with both Public and Private/TEE Solana smart contracts at sub-second speeds.

---

## 🌟 Key Features

*   **⚡ Ephemeral Rollups (ER)**: High-speed parallelized execution layer. The application delegates the Solana L1 state to the ER, allowing for millisecond latency on subsequent transactions.
*   **🔒 Public & Private Modes**:
    *   **Public Mode**: Delegates states to the public Magicblock devnet.
    *   **Private Mode (TEE)**: Uses a Trusted Execution Environment validator and secure cryptographic tokens to run computations under complete confidentiality.
*   **🔑 Embedded Privy Authentication**: No external Solana browser extension required. Privy provisions a secure embedded Solana wallet automatically upon login.
*   **🔄 Live Synchronization**: Subscribes to real-time account updates on both L1 Solana and the Ephemeral Rollup using fast WebSocket connection handlers.
*   **💸 Auto-Airdrop & Funding Banners**: Integrated safety checks ensure the user has sufficient Devnet SOL to cover delegation and state transitions.

---

## 📐 Architecture & How It Works

```
                     ┌────────────────────────────────┐
                     │         Solana L1 (Devnet)     │
                     └───────────────┬────────────────┘
                                     │
                        Delegate     │     Undelegate
                      (L1 -> Rollup) │   (Rollup -> L1)
                                     ▼
                     ┌────────────────────────────────┐
                     │    Ephemeral Rollup (L2)       │
                     ├────────────────────────────────┤
                     │  • Sub-second latency          │
                     │  • High-frequency increments   │
                     │  • Zero gas fee friction       │
                     └────────────────────────────────┘
```

1.  **Initialize**: The application retrieves the Counter PDA status from Solana L1.
2.  **Delegate**: The owner signs a `delegate()` instruction which locks the Counter PDA account on the base layer (L1) and assigns its authority to the Ephemeral Rollup validator (L2).
3.  **Perform High-Speed Actions**: Once delegated, clicking the grid increments the counter on the ER immediately. Transactions skip preflight checks and resolve in milliseconds.
4.  **Undelegate**: Releasing the state triggers the `undelegate()` transaction, which aggregates the ER state delta and settles it atomically back to the Solana L1 layer.

---

## 🛠️ Tech Stack

*   **Framework**: [React 18](https://reactjs.org/) + [TypeScript](https://www.typescriptlang.org/)
*   **Styling**: [Sass (SCSS)](https://sass-lang.com/) & [Framer Motion](https://www.framer.com/motion/) for animations
*   **Solana Integration**: `@solana/web3.js` & `@coral-xyz/anchor`
*   **Rollups**: `@magicblock-labs/ephemeral-rollups-sdk`
*   **Auth & Wallets**: `@privy-io/react-auth` (Solana Embedded Wallets)
*   **Build Tool**: `@craco/craco` (to patch Node polyfills in React Scripts)

---

## ⚙️ Configuration & Environment Variables

Copy the template environment file to create your local configurations:

```bash
cp .env.example .env.local
```

Configure the following variables in `.env.local`:

| Variable | Description | Default Value |
| :--- | :--- | :--- |
| `REACT_APP_PROVIDER_ENDPOINT` | Base Solana RPC Endpoint (Devnet/Localnet) | `https://api.devnet.solana.com` |
| `REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT` | Ephemeral Rollup RPC provider | `https://devnet.magicblock.app` |
| `REACT_APP_TEE_PROVIDER_ENDPOINT` | TEE Private Rollup Provider Endpoint | `https://devnet-tee.magicblock.app` |
| `REACT_APP_PRIVY_APP_ID` | Your Privy App Identification Key | *Required (Get at console.privy.io)* |

> [!NOTE]
> You must register for a free account at [Privy Console](https://console.privy.io/) to get a `REACT_APP_PRIVY_APP_ID`. Make sure to enable **Solana Wallets** in the Privy Console configuration dashboard.

---

## 🚀 Getting Started

### 1. Install Dependencies
You can use `yarn`, `npm`, or `bun` to fetch project dependencies:

```bash
# Using Yarn (Recommended)
yarn install

# Using NPM
npm install

# Using Bun
bun install
```

### 2. Run Development Server
Spin up the local developer server:

```bash
# Using Yarn
yarn dev

# Using NPM
npm run dev

# Using Bun
bun run dev
```

The app will start at `http://localhost:3000`.

### 3. Build for Production
Generate optimized static bundles inside the `build` folder:

```bash
yarn build
```

---

## 💡 Troubleshooting & Common Issues

### ⚠️ "PrivyAppId is not configured"
Verify that you have created a `.env.local` file in the root of this directory and added your `REACT_APP_PRIVY_APP_ID`.

### 💸 "Insufficient balance for delegation"
Embedded wallets need a tiny amount of Devnet SOL to initiate delegation. Use the integrated **Fund Wallet** banner to quickly request a Devnet airdrop or copy the address and run:
```bash
solana airdrop 1 <YOUR_EMBEDDED_WALLET_ADDRESS> --url devnet
```

### 🔒 TEE Authentication Failures in Private Mode
Make sure your embedded wallet is fully initialized and authenticated. TEE mode requires a signed session challenge generated securely using the Privy wallet signature.

---

## 💚 Open Source & Contributing

Open source is at the heart of what we do at **MagicBlock**. We believe building software in the open, with thriving developer communities, helps leave the world a little better than we found it.

Feel free to open issues, submit pull requests, or join us on Discord to discuss new ideas and improvements!