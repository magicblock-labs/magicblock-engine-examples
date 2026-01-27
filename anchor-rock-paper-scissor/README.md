# Anchor Rock Paper Scissor

A confidential Rock Paper Scissor game built on Solana using Anchor and MagicBlock's Ephemeral Rollups SDK. This example demonstrates how to implement a two-player game with hidden choices that remain private during gameplay until the winner is revealed.

## Overview

This project showcases:
- **Solana Smart Contract**: Built with Anchor framework
- **Confidentiality**: Player choices are hidden using MagicBlock's Ephemeral Rollups
- **On-chain Game Logic**: Automated winner determination with transparent results
- **Permission System**: Fine-grained access control via the ephemeral rollups SDK

## Versioning

The following software packages may be required, other versions may also be compatible:

| Software | Version | Installation Guide |
|----------|---------|-------------------|
| Solana | 2.3.13 | [Install Solana](https://docs.solana.com/cli/install-solana-cli-tools) |
| Rust | 1.85.0 | [Install Rust](https://www.rust-lang.org/tools/install) |
| Anchor | 0.32.1 | [Install Anchor](https://www.anchor-lang.com/docs/installation) |
| Node | 24.10.0 | [Install Node](https://nodejs.org/) |

## Prerequisites

- **Rust**: 1.85.0
- **Node.js**: 24.10.0
- **Solana CLI**: 2.3.13
- **Anchor CLI**: 0.32.1
- **Yarn**: Package manager (or npm)

### Installation

1. Install Rust:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

2. Install Solana CLI:
```bash
sh -c "$(curl -sSfL https://release.solana.com/v1.18.0/install)"
```

3. Install Anchor:
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

4. Configure Solana (optional, for devnet):
```bash
solana config set --url devnet
```

## Project Structure

```
anchor-rock-paper-scissor/
├── programs/
│   └── anchor-rock-paper-scissor/
│       ├── src/
│       │   └── lib.rs                 # Program logic
│       └── Cargo.toml
├── tests/
│   └── anchor-rock-paper-scissor.ts   # Test suite
├── Anchor.toml                        # Anchor configuration
├── Cargo.toml                         # Workspace configuration
└── package.json                       # Node dependencies
```

## Build

Build the Solana program:

```bash
anchor build
```

This will:
- Compile the Rust program
- Generate TypeScript IDL (Interface Definition Language)
- Output artifacts to the `target/` directory

## Deployment

### Deploy to Devnet

1. Set your wallet (if not already configured):
```bash
solana config set --keypair ~/.config/solana/id.json
```

2. Update `Anchor.toml` with your program ID (after first deployment)

3. Deploy:
```bash
anchor deploy --provider.cluster devnet
```

The deployment will output your program ID. Update `Anchor.toml` and redeploy with the correct ID.

### Deploy to Localnet

Start a local Solana validator:
```bash
solana-test-validator
```

In another terminal, deploy:
```bash
anchor deploy --provider.cluster localnet
```

## Testing

### Install Dependencies

```bash
yarn install
```

### Run Tests

Run the full test suite:

```bash
yarn test
```

The test suite includes:
1. **Airdrop SOL** - Fund test players
2. **Create Game** - Player 1 initiates a game
3. **Join Game** - Player 2 joins the game
4. **Make Choices** - Both players privately make their choices
5. **Verify Privacy** - Confirm choices remain hidden from opponent
6. **Reveal Winner** - Determine and announce the game winner

### Custom Test Endpoint

To test against a custom ephemeral rollup endpoint:

```bash
EPHEMERAL_PROVIDER_ENDPOINT=http://your-endpoint:port \
EPHEMERAL_WS_ENDPOINT=ws://your-endpoint:port \
yarn test
```

## Usage

### Game Flow

1. **Player 1 creates a game** with a unique game ID
2. **Player 2 joins** the same game
3. **Both players make hidden choices** (Rock, Paper, or Scissors)
4. **Choices are encrypted** in the ephemeral rollup
5. **Winner is revealed** - game logic determines the winner
6. **Results are finalized** on-chain

### Example Test Output

```
Program ID: <program-address>
Game ID (u64): 1706309545000
...
✅ Game Created: <tx-hash>
✅ Player 2 joined game <id>: <tx-hash>
✅ Player 1 chose {"rock":{}}: <tx-hash>
✅ Player 2 chose {"paper":{}}: <tx-hash>
✅ Reveal Winner TX Sent: <tx-hash>
🎲 Game Result Account Data: {winner: 2, player1Choice: {...}, player2Choice: {...}}
```

## Key Concepts

### Ephemeral Rollups

Player choices are processed in MagicBlock's Ephemeral Rollups, which provides:
- **TEE Execution**: Encrypted execution environment
- **Privacy**: Other players cannot see choices until revealed
- **Finality**: Results are committed to Solana mainnet

### Program Accounts

- **Game Account**: Stores game state and result
- **PlayerChoice Account**: Stores a player's encrypted choice (PDAs)
- **Permission Account**: Controls access to encrypted data

### Anchor Instructions

- `create_game` - Initialize a new game
- `join_game` - Add the second player
- `make_choice` - Submit encrypted choice
- `create_permission` - Setup access control
- `delegate_pda` - Delegate PDA to TEE validator
- `reveal_winner` - Compute and store result

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EPHEMERAL_PROVIDER_ENDPOINT` | `https://tee.magicblock.app` | Ephemeral rollup RPC endpoint |
| `EPHEMERAL_WS_ENDPOINT` | `wss://tee.magicblock.app` | WebSocket endpoint for subscriptions |

## Troubleshooting

### Build Errors

**Error: "anchor-lang not found"**
- Run: `cargo update`
- Ensure Rust is up to date: `rustup update`

### Deployment Issues

**Error: "Account does not have enough SOL"**
- Airdrop SOL: `solana airdrop 10 <your-address> --url devnet`

### Test Failures

**Tests timeout or fail to connect**
- Verify the ephemeral endpoint is reachable
- Check your internet connection
- Ensure the Solana cluster is available

**Permission denied errors**
- Ensure wallet has sufficient SOL for transaction fees
- Check permission setup in test (game and choice PDAs)

## Development

### Modify Program Logic

Edit `programs/anchor-rock-paper-scissor/src/lib.rs`:

1. Update instruction handlers
2. Run `anchor build` to compile
3. Run `yarn test` to validate changes

### Generate New Types

After program changes:
```bash
anchor build --skip-lint
```

This regenerates TypeScript types in `target/types/`.

## References

- [Anchor Documentation](https://www.anchor-lang.com/)
- [Solana Documentation](https://docs.solana.com/)
- [MagicBlock Ephemeral Rollups SDK](https://github.com/magicblock-labs/ephemeral-rollups-sdk)
- [Solana Web3.js](https://github.com/solana-labs/solana-web3.js)

## License

MIT

## Support

For issues or questions:
1. Check existing GitHub issues
2. Review test logs for error details
3. Ensure all prerequisites are installed
4. Verify network connectivity to Solana endpoints
