# Oncurve Wallet Delegation Tests

Test suite for delegating on-chain accounts to the Ephemeral Rollups system and managing their lifecycle.

## Test Structure

- **web3js/**: Tests using the web3.js library
  - `delegateOncurve.test.ts`: Main test suite
  - `initializeKeypair.ts`: Helper functions for keypair management

- **kit/**: Tests using Solana Kit
  - `delegateOncurve.test.ts`: Main test suite
  - `initializeKeypair.ts`: Helper functions for keypair management

## Running Tests

### Web3.js Tests
```bash
npm run test:web3js
```

### Solana Kit Tests
```bash
npm run test
```

## Test Flow

The test suite validates the delegation lifecycle:

1. **Assign Owner + Delegate**: Assigns ownership to the delegation program and creates a delegation instruction
2. **Commit**: Commits the account state from ER to the base layer
3. **Commit and Undelegate**: Commits the final state and undelegates the account

## Environment Variables

Configure these in your `.env` file:

```env
# RPC Endpoints
PROVIDER_ENDPOINT=http://localhost:8899        # Base layer RPC
WS_ENDPOINT=ws://localhost:8900                # Base layer WebSocket

# Account Configuration
ONCURVE_ACCOUNT=<public_key>                   # Account to delegate (defaults to payer)
VALIDATOR_ADDRESS=<public_key>                 # Validator address (defaults to payer)

# Keypair
PRIVATE_KEY=[<comma_separated_bytes>]          # Your private key (auto-generated if not provided)
```

## Instruction Discriminators

### Delegation Program Instructions
- **Delegate**: `[0, 0, 0, 0, 0, 0, 0, 0]` (8-byte Anchor discriminator)
  - Delegates an on-curve account to the delegation program
  - Includes commit frequency and optional validator configuration

- **Undelegate**: `[3, 0, 0, 0, 0, 0, 0, 0]` (8-byte Anchor discriminator)
  - Undelegates an account from the delegation program
  - Restores account to original owner program

### Magic Program Instructions
- **ScheduleCommit**: `[1, 0, 0, 0]` (4-byte Bincode discriminator)
  - Commits account state from Ephemeral Rollups to base layer
  
- **ScheduleCommitAndUndelegate**: `[2, 0, 0, 0]` (4-byte Bincode discriminator)
  - Commits final state and undelegates in a single instruction

## Notes

- The test suite uses `vitest` for test execution
- Each test has a 60-second timeout
- Tests are sequential and depend on previous state
