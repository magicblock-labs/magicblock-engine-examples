import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { AnchorCounter } from "../target/types/anchor_counter";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";

const SEED_TEST_PDA = "test-pda"; // 5fSfSTkNZ4czi3w5bRyDaC8dLretQv9Zy77KRBXQ7ZzB

describe.only("anchor-counter", () => {
  console.log("anchor-counter.ts");

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
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_TEST_PDA)],
    program.programId,
  );

  console.log("Program ID: ", program.programId.toString());
  console.log("Counter PDA: ", pda.toString());

  it("Initialize counter on Solana", async () => {
    const start = Date.now();
    let tx = await program.methods
      .initialize()
      .accounts({
        user: provider.wallet.publicKey,
      })
      .transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (
      await provider.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await provider.sendAndConfirm(tx, [], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) Initialize txHash: ${txHash}`);
  });

  it("Increase counter on Solana", async () => {
    const start = Date.now();
    let tx = await program.methods
      .increment()
      .accounts({
        counter: pda,
      })
      .transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (
      await provider.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await provider.sendAndConfirm(tx, [], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) Increment txHash: ${txHash}`);
  });

  it("Delegate counter to ER", async () => {
    const start = Date.now();
    // Add local validator identity to the remaining accounts if running on localnet
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
        pda: pda,
      })
      .remainingAccounts(remainingAccounts)
      .transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (
      await provider.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await provider.sendAndConfirm(tx, [], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) Delegate txHash: ${txHash}`);
  });

  it("Increase counter on ER", async () => {
    const start = Date.now();
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
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx);
    const duration = Date.now() - start;
    console.log(`${duration}ms (ER) Increment txHash: ${txHash}`);
  });

  it("Commit counter state on ER to Solana", async () => {
    const start = Date.now();
    let tx = await program.methods
      .commit()
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
      })
      .transaction();
    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);

    const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: true,
    });
    const duration = Date.now() - start;
    console.log(`${duration}ms (ER) Commit txHash: ${txHash}`);

    // Get the commitment signature on the base layer
    const comfirmCommitStart = Date.now();
    // Await for the commitment on the base layer
    const txCommitSgn = await GetCommitmentSignature(
      txHash,
      providerEphemeralRollup.connection,
    );
    const commitDuration = Date.now() - comfirmCommitStart;
    console.log(
      `${commitDuration}ms (Base Layer) Commit txHash: ${txCommitSgn}`,
    );
  });

  it("Increase counter on ER and commit", async () => {
    const start = Date.now();
    let tx = await program.methods
      .incrementAndCommit()
      .accounts({})
      .transaction();
    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx);
    const duration = Date.now() - start;
    console.log(`${duration}ms (ER) Increment and Commit txHash: ${txHash}`);
  });

  it("Increment and undelegate counter on ER to Solana", async () => {
    const start = Date.now();
    let tx = await program.methods
      .incrementAndUndelegate()
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
    const duration = Date.now() - start;
    console.log(`${duration}ms (ER) Increment and Undelegate txHash: ${txHash}`);
  });
});
