import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorCounter } from "../target/types/anchor_counter";
import {
  DELEGATION_PROGRAM_ID,
  GetCommitmentSignature,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const SEED_TEST_PDA = "test-pda"; // 5RgeA5P8bRaynJovch3zQURfJxXL3QK2JYg1YamSvyLb

describe("anchor-counter", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.PROVIDER_ENDPOINT || "https://devnet.magicblock.app/",
      {
        wsEndpoint: process.env.WS_ENDPOINT || "wss://devnet.magicblock.app/",
      }
    ),
    anchor.Wallet.local()
  );

  const program = anchor.workspace.AnchorCounter as Program<AnchorCounter>;
  const ephemeralProgram = new Program(program.idl, providerEphemeralRollup);
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_TEST_PDA)],
    program.programId
  );

  it("Initializes the counter if it is not already initialized.", async () => {
    const counterAccountInfo = await provider.connection.getAccountInfo(pda);
    if (counterAccountInfo === null) {
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
    }

    const counterAccount = await program.account.counter.fetch(pda);
    console.log("Counter: ", counterAccount.count.toString());
  });

  it("Increase the counter", async () => {
    const counterAccountInfo = await provider.connection.getAccountInfo(pda);
    if (counterAccountInfo.owner.toBase58() == DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Counter is locked by the delegation program");
      return;
    }
    const tx = await program.methods
      .increment()
      .accounts({
        counter: pda,
      })
      .rpc();
    console.log("Increment Tx: ", tx);

    const counterAccount = await program.account.counter.fetch(pda);
    console.log("Counter: ", counterAccount.count.toString());
  });

  it("Delegate a PDA", async () => {
    const counterAccountInfo = await provider.connection.getAccountInfo(pda);
    if (counterAccountInfo.owner.toBase58() == DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Counter is locked by the delegation program");
      return;
    }
    let tx = await program.methods
      .delegate()
      .accounts({
        payer: provider.wallet.publicKey,
        pda: pda,
      })
      .transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (
      await provider.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txSign = await provider.sendAndConfirm(tx, [], {
      skipPreflight: true,
      commitment: "confirmed",
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

    const counterAccount = await ephemeralProgram.account.counter.fetch(pda);
    console.log("Counter: ", counterAccount.count.toString());
  });

  it("Increase the delegate counter and commit through CPI", async () => {
    let tx = await program.methods
      .incrementAndCommit()
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
        // @ts-ignore
        counter: pda,
      })
      .transaction();
    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);

    const txSign = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: true,
    });
    console.log("Increment Tx and Commit: ", txSign);

    // Await for the commitment on the base layer
    const txCommitSgn = await GetCommitmentSignature(
      txSign,
      providerEphemeralRollup.connection
    );
    console.log("Account commit signature:", txCommitSgn);
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction(
      {
        signature: txCommitSgn,
        ...latestBlockhash,
      },
      "confirmed"
    );

    const counterAccount = await program.account.counter.fetch(pda);
    console.log("Counter: ", counterAccount.count.toString());
  });

  it("Increase the delegate counter and undelegate through CPI", async () => {
    let tx = await program.methods
      .incrementAndUndelegate()
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
        // @ts-ignore
        counter: pda,
      })
      .transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);

    const txSign = await providerEphemeralRollup.sendAndConfirm(tx);
    console.log("Increment Tx and Commit: ", txSign);

    const counterAccount = await ephemeralProgram.account.counter.fetch(pda);
    console.log("Counter: ", counterAccount.count.toString());
  });
});
