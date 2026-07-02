# ➕ Anchor Counter

Simple counter program using Anchor and Ephemeral Rollups.

## Software Packages

This program has utilized the following software packages.

| Software   | Version | Installation Guide                                              |
| ---------- | ------- | --------------------------------------------------------------- |
| **Solana** | 3.1.9   | [Install Solana](https://docs.anza.xyz/cli/install)             |
| **Rust**   | 1.89.0  | [Install Rust](https://www.rust-lang.org/tools/install)         |
| **Anchor** | 1.0.2   | [Install Anchor](https://www.anchor-lang.com/docs/installation) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)          |

```sh
agave-install init 3.1.9
rustup install 1.89.0
avm use 1.0.2
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

`yarn setup` runs `SETUP_ONLY=1 ./scripts/test-locally.sh anchor-counter` from the repo root: it builds this example, boots the validators, and holds them until you press a key.

Then, in a second terminal, run this example's tests against that cluster:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster (without it the tests fall back to devnet).

> Tip: to build and run **every** example end-to-end (what CI does), run the repo-root `./scripts/test-locally.sh` directly.

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
