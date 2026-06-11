# ➕ Rust Counter

Simple counter program using Rust Native and Ephemeral Rollups

## Software Packages

| Software   | Version | Installation Guide                                      |
| ---------- | ------- | ------------------------------------------------------- |
| **Solana** | 3.1.9   | [Install Solana](https://docs.anza.xyz/cli/install)     |
| **Rust**   | 1.89.0  | [Install Rust](https://www.rust-lang.org/tools/install) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)  |

```sh
agave-install init 3.1.9
rustup install 1.89.0
```

## Build and Test

Install dependencies and build the program:

```bash
yarn
yarn build
```

This example runs against a **local MagicBlock cluster** — a base Solana validator plus an Ephemeral Rollup, fronted by the Query Filtering Service. Start it in one terminal and leave it running:

```bash
yarn setup
```

`yarn setup` runs `SETUP_ONLY=1 ./test-locally.sh rust-counter` from the repo root: it builds this example, boots the validators, and holds them until you press a key.

Then, in a second terminal, run this example's tests against that cluster:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster (without it the tests fall back to devnet). The `@solana/kit` suite is the default; `yarn test:web3js` runs the equivalent `@solana/web3.js` tests.

> Tip: to build and run **every** example end-to-end (what CI does), run the repo-root `./test-locally.sh` directly.

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
