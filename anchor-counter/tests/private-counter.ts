import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { PrivateCounter } from "../target/types/private_counter";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { GetCommitmentSignature, getAuthToken, TX_LOGS_FLAG, PERMISSION_SEED, PERMISSION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import * as nacl from "tweetnacl";

const COUNTER_SEED = "counter";

describe("private-counter", () => {
  console.log("private-counter.ts");

  let provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com", {
      wsEndpoint: process.env.PROVIDER_ENDPOINT || undefined,
      commitment: "confirmed",
    }),
    anchor.Wallet.local(),
  );
  anchor.setProvider(provider);

  const teeUrl = "https://devnet-tee.magicblock.app";
  const teeWsUrl = "wss://devnet-tee.magicblock.app";
  const ephemeralRpcEndpoint = (
    process.env.EPHEMERAL_PROVIDER_ENDPOINT || teeUrl
  ).replace(/\/$/, "");

  let providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(ephemeralRpcEndpoint, {
      wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || undefined,
      commitment: "confirmed",
    }),
    anchor.Wallet.local(),
  );

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    providerEphemeralRollup.connection.rpcEndpoint,
  );
  console.log(`Current SOL Public Key: ${anchor.Wallet.local().publicKey}`);

  before(async function () {
    try {
      const balance = await provider.connection.getBalance(
        anchor.Wallet.local().publicKey,
      );
      console.log("Current balance is", balance / LAMPORTS_PER_SOL, " SOL", "\n");
    } catch (error) { 
      console.log("Error fetching balance:", error);
    }
    
    // Fetch auth token for the TEE endpoint and rebuild the ER provider with it
    if (ephemeralRpcEndpoint.includes("tee")) {
      const payer = (provider.wallet as anchor.Wallet).payer;
      const authToken = await getAuthToken(
        ephemeralRpcEndpoint,
        payer.publicKey,
        (message: Uint8Array) =>
          Promise.resolve(nacl.sign.detached(message, payer.secretKey)),
      );
      console.log(
        "TEE Explorer URL:",
        `https://solscan.io/?cluster=custom&customUrl=${teeUrl}?token=${authToken.token}`,
      );
      providerEphemeralRollup = new anchor.AnchorProvider(
        new anchor.web3.Connection(
          `${teeUrl}?token=${authToken.token}`,
          {
            wsEndpoint: `${teeWsUrl}?token=${authToken.token}`,
            commitment: "confirmed",
          },
        ),
        anchor.Wallet.local(),
      );
    }
  });

  const program = anchor.workspace.PrivateCounter as Program<PrivateCounter>;

  const [counterPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId,
  );

  // Permission PDA is derived from the program's own ID (not the permission program)
  const [permissionPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(PERMISSION_SEED), counterPDA.toBuffer()],
    PERMISSION_PROGRAM_ID,
  );

  console.log("Program ID: ", program.programId.toString());
  console.log("Counter PDA: ", counterPDA.toString());
  console.log("Permission PDA: ", permissionPDA.toString());

  it("Initialize counter on Solana", async () => {
    const start = Date.now();
    const tx = await program.methods
      .initialize()
      .accounts({
        user: provider.wallet.publicKey,
      })
      .transaction();
    const txHash = await provider.sendAndConfirm(tx, [provider.wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log(`${Date.now() - start}ms (Base Layer) Initialize txHash: ${txHash}`);
  });

  it("Increase counter on Solana", async () => {
    const start = Date.now();
    const tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
      })
      .transaction();
    const txHash = await provider.sendAndConfirm(tx, [provider.wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log(`${Date.now() - start}ms (Base Layer) Increment txHash: ${txHash}`);
  });

  it("Delegate counter to ER with permission", async () => {
    const start = Date.now();
    // Passing null for members means no access restriction (open to all)
    const tx = await program.methods
      .delegate(
        [{ flags: TX_LOGS_FLAG, pubkey: provider.wallet.publicKey }]
      )
      .accounts({
        payer: provider.wallet.publicKey,
        // Pin to the TEE validator identity
        validator: new web3.PublicKey(
          "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
        ),
      })
      .transaction();
    const txHash = await provider.sendAndConfirm(tx, [provider.wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log(
      `${Date.now() - start}ms (Base Layer) Delegate txHash: ${txHash}`,
    );
    // Wait for delegation to propagate to the ER
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  it("Increase counter on ER", async () => {
    const start = Date.now();
    let tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
      })
      .transaction();
    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx);
    console.log(`${Date.now() - start}ms (ER) Increment txHash: ${txHash}`);
  });

  it("Update permission members on ER", async () => {
    const start = Date.now();
    const members = [
      { flags: TX_LOGS_FLAG, pubkey: provider.wallet.publicKey },
    ];
    let tx = await program.methods
      .updatePermission(members)
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
        authority: counterPDA,
      })
      .transaction();
    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx);
    console.log(
      `${Date.now() - start}ms (ER) Update Permission txHash: ${txHash}`,
    );
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
    console.log(`${Date.now() - start}ms (ER) Commit txHash: ${txHash}`);

    // Await the commitment confirmation on the base layer
    const commitStart = Date.now();
    const txCommitSgn = await GetCommitmentSignature(
      txHash,
      providerEphemeralRollup.connection,
    );
    console.log(
      `${Date.now() - commitStart}ms (Base Layer) Commit txHash: ${txCommitSgn}`,
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
    console.log(
      `${Date.now() - start}ms (ER) Increment and Commit txHash: ${txHash}`,
    );
  });

  it("Commit and undelegate permission from ER to Solana", async () => {
    const start = Date.now();
    let tx = await program.methods
      .commitAndUndelegatePermission()
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
    console.log(
      `${Date.now() - start}ms (ER) Undelegate Permission txHash: ${txHash}`,
    );
    // Wait for permission undelegation to settle back on the base layer
    await new Promise((resolve) => setTimeout(resolve, 5000));
  });

  it("Increment and undelegate counter from ER to Solana", async () => {
    const start = Date.now();
    let tx = await program.methods
      .incrementAndUndelegate()
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
      })
      .transaction();
    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx);
    console.log(
      `${Date.now() - start}ms (ER) Increment and Undelegate txHash: ${txHash}`,
    );
    // Wait for counter undelegation to settle back on the base layer
    await new Promise((resolve) => setTimeout(resolve, 5000));
  });

});
