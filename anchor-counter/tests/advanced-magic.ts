import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorCounter } from "../target/types/anchor_counter";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getClosestValidator,
  GetCommitmentSignature,
  sendAndConfirmMagicTransaction,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const SEED_TEST_PDA = "test-pda"; // GS5bf2RCq8AEtSGURYUnHVqDi2iWceg78DTQFZ5q1Wzv

describe("magic-router-and-multiple-atomic-ixs", () => {
  console.log("advanced-magic.ts");

  const providerMagic = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_ROUTER_ENDPOINT ||
        "https://devnet-router.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_ROUTER_ENDPOINT ||
          "wss://devnet-router.magicblock.app/",
      },
    ),
    anchor.Wallet.local(),
  );

  before(async function () {
    const balance = await providerMagic.connection.getBalance(
      anchor.Wallet.local().publicKey,
    );
    console.log("Current balance is", balance / LAMPORTS_PER_SOL, " SOL", "\n");
  });

  const program = anchor.workspace.AnchorCounter as Program<AnchorCounter>;
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_TEST_PDA)],
    program.programId,
  );

  console.log("Program ID: ", program.programId.toString());
  console.log("Counter PDA: ", pda.toString());

  // Run this once before all tests
  let ephemeralValidator;
  before(async function () {
    console.log("Endpoint:", providerMagic.connection.rpcEndpoint.toString());
    ephemeralValidator = await getClosestValidator(providerMagic.connection);
    console.log("Detected validator identity:", ephemeralValidator);
    const balance = await providerMagic.connection.getBalance(
      anchor.Wallet.local().publicKey,
    );
    console.log("Current balance is", balance / LAMPORTS_PER_SOL, " SOL", "\n");
  });

  it("Initialize counter on Solana", async () => {
    const start = Date.now();
    const tx = await program.methods
      .initialize()
      .accounts({
        // @ts-ignore
        counter: pda,
        user: providerMagic.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    const txHash = await sendAndConfirmMagicTransaction(
      providerMagic.connection,
      tx,
      [providerMagic.wallet.payer],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) Initialize txHash: ${txHash}`);
  });

  it("Delegate counter to ER", async () => {
    const start = Date.now();
    let tx = await program.methods
      .delegate()
      .accounts({
        payer: providerMagic.wallet.publicKey,
        pda: pda,
      })
      .transaction();
    const txHash = await sendAndConfirmMagicTransaction(
      providerMagic.connection,
      tx,
      [providerMagic.wallet.payer],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) Delegate txHash: ${txHash}`);
  });

  it("Increase delegated counter and commit through CPI", async () => {
    const start = Date.now();
    let tx = await program.methods
      .incrementAndCommit()
      .accounts({
        payer: providerMagic.wallet.publicKey,
        // @ts-ignore
        counter: pda,
      })
      .transaction();
    const txHash = await sendAndConfirmMagicTransaction(
      providerMagic.connection,
      tx,
      [providerMagic.wallet.payer],
      {
        skipPreflight: true,
      },
    );
    const duration = Date.now() - start;
    console.log(`${duration}ms (ER) Increment And Commit txHash: ${txHash}`);

    // Get the commitment signature on the base layer
    const comfirmCommitStart = Date.now();
    // Await for the commitment on the base layer
    const txCommitSgn = await GetCommitmentSignature(
      txHash,
      new Connection(ephemeralValidator.fqdn),
    );
    const commitDuration = Date.now() - comfirmCommitStart;
    console.log(
      `${commitDuration}ms (Base Layer) Commit txHash: ${txCommitSgn}`,
    );
  });

  it("Increase the delegate counter and undelegate through CPI", async () => {
    const start = Date.now();
    let tx = await program.methods
      .incrementAndUndelegate()
      .accounts({
        payer: providerMagic.wallet.publicKey,
        // @ts-ignore
        counter: pda,
      })
      .transaction();
    const txHash = await sendAndConfirmMagicTransaction(
      providerMagic.connection,
      tx,
      [providerMagic.wallet.payer],
      {
        skipPreflight: true,
      },
    );
    const duration = Date.now() - start;
    console.log(
      `${duration}ms (ER) Increment and Undelegate txHash: ${txHash}`,
    );

    // Get the undelegate signature on the base layer
    const comfirmCommitStart = Date.now();
    // Await for the commitment on the base layer
    const txCommitSgn = await GetCommitmentSignature(
      txHash,
      new Connection(ephemeralValidator.fqdn),
    );
    const commitDuration = Date.now() - comfirmCommitStart;
    console.log(
      `${commitDuration}ms (Base Layer) Undelegate txHash: ${txCommitSgn}`,
    );
  });
});
