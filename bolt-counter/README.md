# ➕ Bolt Counter

Simple counter program using Bolt and Ephemeral Rollups.

Read more about the Bolt framework here: https://docs.magicblock.gg/BOLT/Introduction/introduction

## ✨ Build and Test

Build the program:

```bash
bolt build
````

Add the Ephemeral Rollup endpoints to the env variables:

```bash
export PROVIDER_ENDPOINT="<provided endpoint>"
export WS_ENDPOINT="<provided endpoint>"
````
   
Run the tests:

```bash
bolt test --skip-deploy
```

## 📤 Delegate an account

Delegating an account is the process of transferring the ownership of an account to the delegation program.
After delegation, the account can be treated as a regular account in the Ephemeral Rollups, where transactions can be run with low-latency. 

A component can be made delegatable by adding the `delegate` attribute.

1. Add the delegate attribute:

   ```rust
   #[component(delegate)]
   #[derive(Default)]
   pub struct Counter {
     pub count: u64,
   }
   ```
   
2. After delegation, you can run transactions on the account with low-latency. Any transaction that would work on the base base layer will work on the delegated account.

## 💥 Execute Transactions

1. Call the instruction to execute the delegation
    
      ```typescript
      const counterPda = FindComponentPda(counterComponent.programId, entityPda);
      const delegateIx = createDelegateInstruction({
         entity: entityPda,
         account: counterPda,
         ownerProgram: counterComponent.programId,
         payer: provider.wallet.publicKey,
      });
      const tx = new anchor.web3.Transaction().add(delegateIx);
      const txSign = await provider.sendAndConfirm(tx);
      ```
2. Apply a system:
    
    ```typescript
    const applySystem = await ApplySystem({
      authority: providerEphemeralRollup.wallet.publicKey,
      system: systemIncrease.programId,
      entity: entityPda,
      components: [counterComponent.programId],
    });
    const txSign = await providerEphemeralRollup.sendAndConfirm(applySystem.transaction);
    ```

## 📥 Undelegate an account

Undelegating an account is the process of transferring the ownership of an account back to the owner program.

You can undelegate with:

```typescript
const counterComponentPda = FindComponentPda(
    counterComponent.programId, entityPda
);
const undelegateIx = createUndelegateInstruction({
   payer: provider.wallet.publicKey,
   delegatedAccount: counterComponentPda,
   ownerProgram: counterComponent.programId,
   reimbursement: provider.wallet.publicKey,
});
const tx = new anchor.web3.Transaction().add(undelegateIx);
await provider.sendAndConfirm(tx);
```