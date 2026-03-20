# Dashboard Setup Guide

## Prerequisites
- Node.js 16+ and npm or yarn
- A Solana wallet (Phantom, Solflare, etc.)
- SOL on Devnet for transaction fees

## Installation

### 1. Install Dependencies
```bash
cd dashboard
npm install
# or
yarn install
```

### 2. Configure Environment Variables
Create `.env.local` in the dashboard directory. Copy from `.env.local.example.txt`:

```bash
# Add these environment variables
NEXT_PUBLIC_EPHEMERAL_PROVIDER_ENDPOINT=https://devnet-as.magicblock.app/
NEXT_PUBLIC_EPHEMERAL_WS_ENDPOINT=wss://devnet-as.magicblock.app/
NEXT_PUBLIC_PROGRAM_ID=rEwArDea6BfpdA8QuBLkTCLESRJfZciUFoHA68FRq6Y
```

### 3. Start Development Server
```bash
npm run dev
# or
yarn dev
```

The dashboard will be available at `http://localhost:3000`

## First Steps

### 1. Connect Your Wallet
Click "Connect Wallet" in the top-right corner and select your wallet provider.

### 2. Check Your Connection
Use the connection selector (top-right) to ensure you're connected to:
- **Solana Devnet** for testing
- **MagicBlock Ephemeral Rollup** for VRF testing

### 3. Initialize Reward Distributor
1. Navigate to **Admin Actions**
2. Click **Initialize Distributor**
3. Confirm the transaction in your wallet
4. Wait for confirmation

### 4. Set Basic Parameters
1. Click **Set Reward List**
2. Configure:
   - Global Range Min: `0`
   - Global Range Max: `1000`
   - Start/End Timestamps: (leave defaults or adjust)
3. Confirm the transaction

### 5. Add Your First Reward
1. Click **Add Reward**
2. Fill in:
   - Reward Name: "Test Reward"
   - Mint Address: (token/NFT mint)
   - Token Account: (your ATA holding the reward)
   - Amount: (quantity)
   - Draw Range: (e.g., 0-100)
   - Redemption Limit: (e.g., 10)
3. Confirm the transaction

## Feature Usage

### Send Tokens to Distributor
1. Go to **Token Management**
2. Click **Send SPL Token**
3. Enter token mint and amount
4. Confirm the transaction

### View Distributor Assets
1. Click **View Distributor Assets**
2. See all tokens/NFTs held by distributor
3. Click "Add to Rewards" to register assets

### Mint NFT Collection
1. Go to **NFT Management**
2. Click **Mint NFT Collection**
3. Provide collection details and metadata URI
4. Confirm the transaction

### Delegate to Ephemeral Rollup
1. Ensure connection is set to **MagicBlock Ephemeral Rollup**
2. Click **Delegate Reward List**
3. Confirm the transaction
4. Now VRF random reward selection will work

## Troubleshooting

### "Wallet not connected"
- Click "Connect Wallet" button
- Ensure your wallet is unlocked
- Refresh the page if needed

### "RPC request failed"
- Check your internet connection
- Try switching connection (use dropdown)
- Wait a moment and try again

### Transaction failed
- Check if you have enough SOL for fees
- Verify all input addresses are valid
- Check error message for specific issues
- Try with smaller amounts first

### Connection issues with MagicBlock
- Verify `.env.local` has correct endpoints
- Check if the Ephemeral Rollup is accessible
- Fall back to Solana Devnet to test basic features

## Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint
```

## Important Notes

⚠️ **Always test on Devnet first!**
- Never use mainnet credentials during development
- Request devnet SOL from faucet if needed
- Back up any important keypairs

✅ **Transaction features:**
- All transactions require wallet signing
- Preflight is skipped (as required by program)
- Maximum 3 retry attempts
- Wait for "confirmed" status

🔒 **Security:**
- Never share your wallet private key
- Only approve transactions you understand
- Use hardware wallets for mainnet
- Verify transaction details before confirming

📚 **References:**
- See `FEATURES.md` for detailed feature documentation
- See `IMPLEMENTATION_SUMMARY.md` for technical details
- Check program IDL at `target/types/rewards_delegated_vrf.ts`

## Getting Help

1. Check error messages carefully - they provide specific guidance
2. Review `FEATURES.md` for feature-specific details
3. Look at test files in `../tests/` for usage examples
4. Check browser console (F12) for detailed error logs

## Next Steps

After setup:
1. Test all admin actions on devnet
2. Create NFT collection and add to rewards
3. Test token transfers
4. Configure VRF delegation
5. Test random reward distribution

Enjoy using the rewards dashboard!
