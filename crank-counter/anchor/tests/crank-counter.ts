import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import { AnchorCounter } from "../target/types/anchor_counter";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { MAGIC_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import idl from "../target/idl/anchor_counter.json";
import { expect } from "chai";

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
          process.env.EPHEMERAL_WS_ENDPOINT ||
          "wss://devnet-as.magicblock.app/",
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
  const programEphemeral = new anchor.Program<AnchorCounter>(
    idl,
    providerEphemeralRollup,
  );
  const [counterPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId,
  );

  console.log("Program ID: ", program.programId.toString());
  console.log("Counter PDA: ", counterPDA.toString());

  it("Initialize counter on Solana", async () => {
    const txHash = await program.methods
      .initialize()
      .accounts({
        user: provider.wallet.publicKey,
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log(`[Base Layer] Initialize txHash: ${txHash}`);

    const counter = await program.account.counter.fetch(counterPDA);
    expect(counter.count.toNumber()).to.equal(0);
  });

  it("Delegate counter to ER", async () => {
    // Validator identity for delegation: VALIDATOR env var unconditionally wins; otherwise
    // default to the local-ER validator iff the ER endpoint is localhost.
    const isLocal =
      providerEphemeralRollup.connection.rpcEndpoint.includes("localhost") ||
      providerEphemeralRollup.connection.rpcEndpoint.includes("127.0.0.1");
    const validatorPubkey = process.env.VALIDATOR
      ? new web3.PublicKey(process.env.VALIDATOR)
      : isLocal
      ? new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev")
      : null;
    const remainingAccounts = validatorPubkey
      ? [{ pubkey: validatorPubkey, isSigner: false, isWritable: false }]
      : [];
    const txHash = await program.methods
      .delegate()
      .accounts({
        payer: provider.wallet.publicKey,
        pda: counterPDA,
      })
      .remainingAccounts(remainingAccounts)
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log(`[Base Layer] Delegate txHash: ${txHash}`);
  });

  it("Schedule increment counter on ER", async () => {
    const txHash = await programEphemeral.methods
      .scheduleIncrement({
        taskId: new BN(1), // Task ID can be arbitrary, used mostly to cancel cranks.
        executionIntervalMillis: new BN(1000), // Milliseconds between executions.
        iterations: new BN(3), // Number of times to execute the task.
      })
      .accounts({
        magicProgram: MAGIC_PROGRAM_ID,
        payer: providerEphemeralRollup.wallet.publicKey,
        program: program.programId,
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log(`[ER] Schedule Increment txHash: ${txHash}`);

    const timeout = 10_000; // 10 seconds max wait
    const pollInterval = 100;
    const startTime = Date.now();
    let counter = await programEphemeral.account.counter.fetch(counterPDA);
    while (counter.count.toNumber() < 2) {
      if (Date.now() - startTime > timeout) {
        throw new Error("Timed out waiting for counter to increment");
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      counter = await programEphemeral.account.counter.fetch(counterPDA);
    }
  });

  it("Undelegate counter on ER to Solana", async () => {
    const txHash = await programEphemeral.methods
      .undelegate()
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log(`[ER] Undelegate txHash: ${txHash}`);
  });

  after(async () => {
    // Exit process to prevent hanging on WebSocket connections
    setTimeout(() => process.exit(0), 100);
  });
});
