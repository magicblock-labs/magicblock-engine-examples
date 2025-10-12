import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { AnchorCounter } from "../target/types/anchor_counter";
import { LAMPORTS_PER_SOL, sendAndConfirmTransaction } from "@solana/web3.js";
import {
    ConnectionMagicRouter, GetCommitmentSignature
} from "@magicblock-labs/ephemeral-rollups-sdk";


const SEED_TEST_PDA = "test-pda"; // GS5bf2RCq8AEtSGURYUnHVqDi2iWceg78DTQFZ5q1Wzv
const ER_VALIDATOR = new web3.PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"); // Asia ER Validator


describe("magic-router-and-multiple-atomic-ixs", () => {
    console.log("advanced-magic.ts")
    
    const connection = new ConnectionMagicRouter(
        process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-router.magicblock.app/", 
        {
          wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-router.magicblock.app/"
        }
    )
    const providerMagic = new anchor.AnchorProvider(connection,anchor.Wallet.local());

  const program = anchor.workspace.AnchorCounter as Program<AnchorCounter>;
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_TEST_PDA)],
    program.programId,
  );
  console.log("Program ID: ", program.programId.toString())
  console.log("Counter PDA: ", pda.toString())

  // Run this once before all tests
  let ephemeralValidator;
  before(async function () {
      console.log("Endpoint:", connection.rpcEndpoint.toString());
      ephemeralValidator = await connection.getClosestValidator();
      console.log("Detected validator identity:", ephemeralValidator);
      const balance = await connection.getBalance(anchor.Wallet.local().publicKey)
      console.log('Current balance is', balance / LAMPORTS_PER_SOL, ' SOL','\n')
  })
  
  it("Initialize counter on Solana", async () => {
    const start = Date.now();
    const tx = await program.methods
      .initialize()
      .accounts({
        user: providerMagic.wallet.publicKey,
      })
      .transaction();
    const txHash = await sendAndConfirmTransaction(connection, tx, [providerMagic.wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed"
    });
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) Initialize txHash: ${txHash}`);
  });

  it("Delegate counter to ER", async () => {
    const start = Date.now();
    let tx = await program.methods
      .delegate()
      .accounts({
        payer: providerMagic.wallet.publicKey,
        validator: ER_VALIDATOR,
        pda: pda,
      })
      .transaction();
    const txHash = await sendAndConfirmTransaction(connection, tx, [providerMagic.wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed"
    });
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) Delegate txHash: ${txHash}`);
  });

  it("Increase delegated counter and commit through CPI", async () => {
    const start = Date.now();
    let tx = await program.methods
      .incrementAndCommit()
      .accounts({
        payer: providerMagic.wallet.publicKey,
      })
      .transaction();
    const txHash = await sendAndConfirmTransaction(connection, tx, [providerMagic.wallet.payer], {
      skipPreflight: true,
    });
    const duration = Date.now() - start;
    console.log(`${duration}ms (ER) Increment And Commit txHash: ${txHash}`);

    // Get the commitment signature on the base layer
    const comfirmCommitStart = Date.now();
    // Await for the commitment on the base layer
    const txCommitSgn = await GetCommitmentSignature(
      txHash,
      new anchor.web3.Connection(ephemeralValidator.fqdn),
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
      })
      .transaction();
    const txHash = await sendAndConfirmTransaction(connection, tx, [providerMagic.wallet.payer], {
      skipPreflight: true,
    });
    const duration = Date.now() - start;
    console.log(
      `${duration}ms (ER) Increment and Undelegate txHash: ${txHash}`,
    );

    // Get the undelegate signature on the base layer
    const comfirmCommitStart = Date.now();
    // Await for the commitment on the base layer
    const txCommitSgn = await GetCommitmentSignature(
      txHash,
      new anchor.web3.Connection(ephemeralValidator.fqdn),
    );
    const commitDuration = Date.now() - comfirmCommitStart;
    console.log(
      `${commitDuration}ms (Base Layer) Undelegate txHash: ${txCommitSgn}`,
    );
  });
});
