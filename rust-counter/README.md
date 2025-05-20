# ➕ Rust Counter

Simple counter program using Rust Native and Ephemeral Rollups

## Software Packages

This program has utilized the following sofware packages.

| Software   | Version | Installation Guide                                      |
| ---------- | ------- | ------------------------------------------------------- |
| **Solana** | 2.0.21  | [Install Solana](https://docs.anza.xyz/cli/install)     |
| **Rust**   | 1.82    | [Install Rust](https://www.rust-lang.org/tools/install) |

````sh
# Check and initialize your Solana version
agave-install list
agave-install init 2.0.21

# Check and initialize your Rust version
rustup show
rustup install 1.82


## ✨ Build and Test

Build and deploy the program:

```bash
cargo build-sbf
solana program deploy target/deploy/rust_counter.so
````

Add wallet (if not a new keypair will be generated) and RPC endpoints to the file example.env and update filename to .env:

```bash
PRIVATE_KEY=
```

Run the tests:

```bash
yarn install
yarn test
```

## 📤 Delegate an account

Delegating an account is the process of transferring the ownership of an account to the delegation program.
After delegation, the account can be treated as a regular account in the Ephemeral Rollups, where transactions can be run with low-latency.

Delegation is done by invoking trough CPI the `delegate` instruction of the delegation program.

1. Add the delegation sdk to your project:

   ```bash
   cargo add ephemeral-rollups-sdk
   ```

2. Add delegation function to your program with and use the CPI call to delegate PDA accounts:

   ```rust
   use ephemeral_rollups_sdk::cpi::{delegate_account, undelegate_account, DelegateAccounts, DelegateConfig};

   pub fn process_delegate(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
   ) -> ProgramResult {

    // Get accounts
    let account_info_iter = &mut accounts.iter();
    let initializer = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;
    let pda_to_delegate = next_account_info(account_info_iter)?;
    let owner_program = next_account_info(account_info_iter)?;
    let delegation_buffer = next_account_info(account_info_iter)?;
    let delegation_record = next_account_info(account_info_iter)?;
    let delegation_metadata = next_account_info(account_info_iter)?;
    let delegation_program = next_account_info(account_info_iter)?;

    // Prepare counter pda seeds
    let seed_1 = b"counter_account";
    let seed_2 = initializer.key.as_ref();
    let pda_seeds: &[&[u8]] = &[seed_1, seed_2];

    let delegate_accounts = DelegateAccounts {
        payer: initializer,
        pda: pda_to_delegate,
        owner_program,
        buffer: delegation_buffer,
        delegation_record,
        delegation_metadata,
        delegation_program,
        system_program,
    };

    let delegate_config = DelegateConfig {
        commit_frequency_ms: 30_000,
        validator: None,
    };

    delegate_account(delegate_accounts, &pda_seeds, delegate_config);

    Ok(())
   }
   ```

3. After delegation, you can run transactions on the account with low-latency. Any transaction that would work on the base base layer will work on the delegated account.

## 💥 Execute Transactions

1. Create the instructions and send transaction to ER:

```typescript
// 1: IncreaseCounter
// Create, send and confirm transaction
const tx = new web3.Transaction();
const keys = [
  // Initializer
  {
    pubkey: userKeypair.publicKey,
    isSigner: true,
    isWritable: true,
  },
  // Counter Account
  {
    pubkey: counterPda,
    isSigner: false,
    isWritable: true,
  },
  // System Program
  {
    pubkey: web3.SystemProgram.programId,
    isSigner: false,
    isWritable: false,
  },
];
const serializedInstructionData = Buffer.concat([
  Buffer.from([CounterInstruction.IncreaseCounter]),
  borsh.serialize(IncreaseCounterPayload.schema, new IncreaseCounterPayload(1)),
]);
const initializeIx = new web3.TransactionInstruction({
  keys: keys,
  programId: PROGRAM_ID,
  data: serializedInstructionData,
});
tx.add(initializeIx);
const txHash = await web3.sendAndConfirmTransaction(
  connectionEphemeralRollup, // "https://devnet.magicblock.app/" or "http://localhost:8899"
  tx,
  [userKeypair],
  {
    skipPreflight: true,
    commitment: "confirmed",
  }
);
console.log("txId:", txHash);
```

## 📥 Undelegate an account

Undelegating an account is the process of transferring the ownership of an account back to the owner program.

You can commit and undelegate with:

```typescript
// 3: CommitAndUndelegate
// Create, send and confirm transaction
const tx = new web3.Transaction();
const keys = [
  // Initializer
  {
    pubkey: userKeypair.publicKey,
    isSigner: true,
    isWritable: true,
  },
  // Counter Account
  {
    pubkey: counterPda,
    isSigner: false,
    isWritable: true,
  },
  // Magic Program
  {
    pubkey: MAGIC_PROGRAM_ID,
    isSigner: false,
    isWritable: false,
  },
  // Magic Context
  {
    pubkey: MAGIC_CONTEXT_ID,
    isSigner: false,
    isWritable: true,
  },
];
const serializedInstructionData = Buffer.from([
  CounterInstruction.CommitAndUndelegate,
]);
const initializeIx = new web3.TransactionInstruction({
  keys: keys,
  programId: PROGRAM_ID,
  data: serializedInstructionData,
});
tx.add(initializeIx);
const txHash = await web3.sendAndConfirmTransaction(
  connectionEphemeralRollup, // "https://devnet.magicblock.app/" or "http://localhost:8899"
  tx,
  [userKeypair],
  {
    skipPreflight: true,
    commitment: "confirmed",
  }
);
console.log("txId:", txHash);
```

## Local Ephemeral Validator

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
PROVIDER_ENDPOINT=http://localhost:8899 WS_ENDPOINT=ws://localhost:8900 yarn test
```

This setup ensures tests run efficiently on a local ephemeral rollup while connecting to the devnet.
