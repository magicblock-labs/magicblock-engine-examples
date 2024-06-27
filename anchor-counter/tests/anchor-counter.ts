import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorCounter } from "../target/types/anchor_counter";
import {
  createUndelegateInstruction,
  createCommitInstruction,
  DelegateAccounts,
  DELEGATION_PROGRAM_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/delegation-program";

const SEED_TEST_PDA = "test-pda";

describe("anchor-counter", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(process.env.PROVIDER_ENDPOINT, {
      wsEndpoint: process.env.WS_ENDPOINT,
    }),
    anchor.Wallet.local()
  );

  const program = anchor.workspace.AnchorCounter as Program<AnchorCounter>;
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_TEST_PDA)],
    program.programId
  );

  it("Initializes the counter if it is not already initialized.", async () => {
    await provider.connection.requestAirdrop(
      provider.wallet.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    const counterAccountInfo = await provider.connection.getAccountInfo(pda);
    if (counterAccountInfo == null) {
      try {
        const tx = await program.methods
          .initialize()
          .accounts({
            // @ts-ignore
            counter: pda,
            user: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc({ skipPreflight: true });
        console.log("Init Pda Tx: ", tx);
      } catch (err) {
        console.error(err);
      }
    }

    const counterAccount = await program.account.counter.fetch(pda);
    console.log("Counter: ", counterAccount.count.toString());
  });

  it("Increase the counter", async () => {
    const counterAccountInfo = await provider.connection.getAccountInfo(pda);
    if (counterAccountInfo.owner.toString() == DELEGATION_PROGRAM_ID) {
      console.log("Counter is locked by the delegation program");
      return;
    }
    const tx = await program.methods
      .increment()
      .accounts({
        counter: pda,
      })
      .rpc({ skipPreflight: true });
    console.log("Increment Tx: ", tx);

    const counterAccount = await program.account.counter.fetch(pda);
    console.log("Counter: ", counterAccount.count.toString());
  });

  it("Delegate a PDA", async () => {
    const counterAccountInfo = await provider.connection.getAccountInfo(pda);
    if (counterAccountInfo.owner.toString() == DELEGATION_PROGRAM_ID) {
      console.log("Counter is locked by the delegation program");
      return;
    }
    const { delegationPda, delegationMetadata, bufferPda } = DelegateAccounts(
      pda,
      program.programId
    );

    // Delegate, Close PDA, and Lock PDA in a single instruction
    let tx = await program.methods
      .delegate()
      .accounts({
        payer: provider.wallet.publicKey,
        pda: pda,
        ownerProgram: program.programId,
        delegationMetadata: delegationMetadata,
        buffer: bufferPda,
        delegationRecord: delegationPda,
        delegationProgram: DELEGATION_PROGRAM_ID,
      })
      .transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (
      await provider.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txSign = await provider.sendAndConfirm(tx, [], {
      skipPreflight: true,
      commitment: "finalized",
    });
    console.log("Your transaction signature", txSign);
  });

  it("Increase the delegate counter", async () => {
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

    const txSign = await providerEphemeralRollup.sendAndConfirm(tx);
    console.log("Increment Tx: ", txSign);

    const counterAccount = await program.account.counter.fetch(pda);
    console.log("Counter: ", counterAccount.count.toString());
  });

  it("Increase the delegate counter and commit through CPI", async () => {
    let tx = await program.methods
      .incrementAndCommit()
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
        counter: pda,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);

    const txSign = await providerEphemeralRollup.sendAndConfirm(tx);
    console.log("Increment Tx and Commit: ", txSign);
    const txx = await providerEphemeralRollup.connection.getTransaction(txSign);
    console.log(txx.meta.logMessages);

    const counterAccount = await program.account.counter.fetch(pda);
    console.log("Counter: ", counterAccount.count.toString());
  });

  it("Manual trigger an account commit", async () => {
    const ix = createCommitInstruction({
      payer: providerEphemeralRollup.wallet.publicKey,
      delegatedAccount: pda,
    });
    let tx = new anchor.web3.Transaction().add(ix);
    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);

    const txSign = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: true,
    });
    console.log("Trigger Manual Commit Tx: ", txSign);
  });

  it("Undelegate the counter", async () => {
    // Create the unlock undelegation instruction
    const { delegationPda, delegationMetadata, bufferPda } = DelegateAccounts(
      pda,
      program.programId
    );
    let tx = await program.methods
      .allowUndelegation()
      .accounts({
        counter: pda,
        delegationRecord: delegationPda,
        delegationMetadata: delegationMetadata,
        buffer: bufferPda,
        delegationProgram: DELEGATION_PROGRAM_ID,
      })
      .transaction();

    // Create the undelegation ix
    const ixUndelegate = createUndelegateInstruction({
      payer: provider.wallet.publicKey,
      delegatedAccount: pda,
      ownerProgram: program.programId,
      reimbursement: provider.wallet.publicKey,
    });
    tx.add(ixUndelegate);

    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (
      await provider.connection.getLatestBlockhash()
    ).blockhash;
    tx = await provider.wallet.signTransaction(tx);

    const txSign = await provider.sendAndConfirm(tx, [], {
      skipPreflight: true,
    });
    console.log("Undelegate Tx: ", txSign);
  });
});
