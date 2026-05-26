## 📝 About

This is a session keys counter example demonstrating:

- **Session Token Management**: Create and revoke session tokens
- **Counter Delegation**: Delegate counter operations to ephemeral rollups
- **Ephemeral Rollups**: Execute transactions on fast, low-cost ephemeral environments
- **Temporary Keypairs**: Use derived keypairs for temporary session transactions

The app displays two counters:

- **Regular Counter**: Incremented on the main Solana network
- **Ephemeral Counter**: Incremented on the MagicBlock ephemeral rollup (when delegated)

## 🚀 Getting Started

### Prerequisites

- Node.js (v16+)
- Solana wallet browser extension (e.g., Phantom)
- Connection to Solana Devnet

### Installation

Using Npm:

```bash
npm install
npm run start
```

Using Yarn:

```bash
yarn install
yarn start
```

The app will open at `http://localhost:3000`

## 🎮 Usage

1. **Connect Wallet**: Click "Select Wallet" and connect your Solana wallet
2. **Create Session**: Click "Create Session" to create a session token
3. **Delegate**: Click "Delegate" to move operations to the ephemeral rollup
4. **Increment**: Click on the counter squares to increment
   - Regular counter: incremented with your wallet
   - Ephemeral counter: incremented with session token (when delegated)
5. **Revoke Session**: Click "Revoke Session" to revoke the session token
6. **Undelegate**: Click "Undelegate" to move operations back to mainnet

## 💚 Open Source

Open Source is at the heart of what we do at MagicBlock. We believe building software in the open, with thriving communities, helps leave the world a little better than we found it.
