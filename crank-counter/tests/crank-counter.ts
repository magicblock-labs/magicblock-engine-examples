import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import { AnchorCounter } from "../target/types/anchor_counter";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { GetCommitmentSignature, ConnectionMagicRouter, MAGIC_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";

const COUNTER_SEED = "counter"; 

describe("crank-counter", () => {

  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://devnet-as.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app/",
      },
    ),
    anchor.Wallet.local(),
  );

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    providerEphemeralRollup.connection.rpcEndpoint,
  );
  console.log(`Current SOL Public Key: ${anchor.Wallet.local().publicKey}`);

  before(async function () {
    const balance = await provider.connection.getBalance(
      anchor.Wallet.local().publicKey,
    );
    console.log("Current balance is", balance / LAMPORTS_PER_SOL, " SOL", "\n");
  });

  const program = anchor.workspace.AnchorCounter as Program<AnchorCounter>;
  const [counterPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId,
  );

  console.log("Program ID: ", program.programId.toString());
  console.log("Counter PDA: ", counterPDA.toString());

  it("Initialize counter on Solana", async () => {
    let tx = await program.methods
      .initialize()
      .accounts({
        user: provider.wallet.publicKey,
      })
      .transaction();

    const txHash = await provider.sendAndConfirm(tx, [provider.wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log(`[Base Layer] Initialize txHash: ${txHash}`);
  });

  it("Delegate counter to ER", async () => {
    // Add local validator identity to the remaining accounts if running on localnet.
    const remainingAccounts =
      providerEphemeralRollup.connection.rpcEndpoint.includes("localhost") ||
      providerEphemeralRollup.connection.rpcEndpoint.includes("127.0.0.1")
        ? [
            {
              pubkey: new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
              isSigner: false,
              isWritable: false,
            },
          ]
        : [];
    let tx = await program.methods
      .delegate()
      .accounts({
        payer: provider.wallet.publicKey,
        pda: counterPDA,
      })
      .remainingAccounts(remainingAccounts)
      .transaction();
    const txHash = await provider.sendAndConfirm(tx, [provider.wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log(`[Base Layer] Delegate txHash: ${txHash}`);
  });

  it("Schedule increment counter on ER", async () => {
    let tx = await program.methods
      .scheduleIncrement({
        taskId: new BN(1), // Task ID can be arbitrary, used mostly to cancel cranks.
        executionIntervalMillis: new BN(100), // Milliseconds between executions.
        iterations: new BN(3), // Number of times to execute the task.
      })
      .accounts({
        magicProgram: MAGIC_PROGRAM_ID,
        payer: providerEphemeralRollup.wallet.publicKey,
        program: program.programId,
      })
      .transaction();
    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);

    const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log(`[ER] Schedule Increment txHash: ${txHash}`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  it("undelegate counter on ER to Solana", async () => {
    let tx = await program.methods
      .undelegate()
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
      })
      .transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);

    const txHash = await providerEphemeralRollup.sendAndConfirm(tx);
    console.log(`[ER] Undelegate txHash: ${txHash}`);

  });

  after(async () => {
    // Exit process to prevent hanging on WebSocket connections
    setTimeout(() => process.exit(0), 100);
  });
});
