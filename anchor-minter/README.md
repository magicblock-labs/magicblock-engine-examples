# ➕ Anchor Minter with Counter

Simple minter and counter program using Anchor and Ephemeral Rollups.

## Software Packages

This program has utilized the following sofware packages.

| Software   | Version | Installation Guide                                              |
| ---------- | ------- | --------------------------------------------------------------- |
| **Solana** | 2.1.21  | [Install Solana](https://docs.anza.xyz/cli/install)             |
| **Rust**   | 1.82    | [Install Rust](https://www.rust-lang.org/tools/install)         |
| **Anchor** | 0.31.1  | [Install Anchor](https://www.anchor-lang.com/docs/installation) |

```sh
# Check and initialize your Solana version
agave-install list
agave-install init 2.1.21

# Check and initialize your Rust version
rustup show
rustup install 1.82

# Check and initialize your Anchor version
avm list
avm use 0.31.1
```

## ✨ Build and Test

Run the tests with existing program:

```bash
yarn
anchor test --skip-deploy --skip-build --skip-local-validator
```

Build, deploy and run the tests with new program (note: delete keypairs in `/target/deploy` folder):

```bash
# Delete keypairs in the deploy folder
rm -rf /target/deploy/*.keypair

# Build, deploy and test program
anchor test
```

## 📤 Delegate an account

Delegating an account is the process of transferring the ownership of an account to the delegation program.
After delegation, the account can be treated as a regular account in the Ephemeral Rollups, where transactions can be run with low-latency.

Delegation is done by invoking trough CPI the `delegate` instruction of the delegation program.

1. Add the delegation sdk to your project:

   ```bash
   cargo add ephemeral-rollups-sdk
   ```

2. Mark your program with `#[delegate]` and add the CPI call to one instruction of your program:

   ```rust
   use ephemeral_rollups_sdk::cpi::delegate_account;
   use ephemeral_rollups_sdk::er::commit_accounts;
   use ephemeral_rollups_sdk::anchor::delegate;


   #[delegate]
   #[program]
   pub mod anchor_counter {

      pub fn delegate(ctx: Context<DelegateInput>) -> Result<()> {
          let pda_seeds: &[&[u8]] = &[TEST_PDA_SEED];

          delegate_account(
              &ctx.accounts.payer,
              &ctx.accounts.pda,
              &ctx.accounts.owner_program,
              &ctx.accounts.buffer,
              &ctx.accounts.delegation_record,
              &ctx.accounts.delegate_account_seeds,
              &ctx.accounts.delegation_program,
              &ctx.accounts.system_program,
              pda_seeds,
              0, // max delegation lifetime, 0 means no limit
              30000, // commit interval in ms (30s)
       )?;

       Ok(())
      }
   }
   ```

3. After delegation, you can run transactions on the account with low-latency. Any transaction that would work on the base base layer will work on the delegated account.

## 💥 Execute Transactions

1. Add the typescript sdk to your project:

   ```bash
   yarn add @magicblock-labs/ephemeral-rollups-sdk
   ```

2. Call the instruction to execute the delegation
3. Execute a transaction:

   ```typescript
   let tx = await program.methods
     .increment()
     .accounts({
       counter: pda,
     })
     .transaction();
   tx.feePayer = providerEphemeralRollup.wallet.publicKey;
   tx.recentBlockhash = (
     await providerEphemeralRollup.connection.getLatestBlockhash()
   ).blockhash;
   tx = await providerEphemeralRollup.wallet.signTransaction(tx);

   const txSign = await providerEphemeralRollup.sendAndConfirm(tx, []);
   console.log("Increment Tx: ", txSign);
   ```

## 📥 Undelegate an account

Undelegating an account is the process of transferring the ownership of an account back to the owner program.

You can undelegate with:

```typescript
const ix = createUndelegateInstruction({
  payer: provider.wallet.publicKey,
  delegatedAccount: pda,
  ownerProgram: program.programId,
  reimbursement: provider.wallet.publicKey,
});
let tx = new anchor.web3.Transaction().add(ix);
tx.feePayer = provider.wallet.publicKey;
tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
tx = await provider.wallet.signTransaction(tx);
```

## Running Tests on Devnet with a Local Ephemeral Rollup

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
