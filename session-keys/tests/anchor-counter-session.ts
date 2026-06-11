import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { AnchorCounterSession } from "../target/types/anchor_counter_session";
import { LAMPORTS_PER_SOL, sendAndConfirmTransaction } from "@solana/web3.js";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { initializeSessionSignerKeypair } from "../utils/initializeKeypair";

const COUNTER_SEED = "counter";

describe.only("anchor-counter-session", () => {
  console.log("anchor-counter-session.ts");

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

  const program = anchor.workspace
    .AnchorCounterSession as Program<AnchorCounterSession>;
  const [counterPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED), provider.wallet.publicKey.toBuffer()],
    program.programId,
  );

  console.log("Program ID: ", program.programId.toString());
  console.log("Counter PDA: ", counterPDA.toString());

  // Initialize Session Manager
  const sessionKeypair = initializeSessionSignerKeypair();
  const sessionTokenManager = new SessionTokenManager(
    provider.wallet,
    provider.connection,
  );
  const SESSION_TOKEN_SEED = "session_token_v2";
  const sessionTokenPDA = web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(SESSION_TOKEN_SEED),
      program.programId.toBytes(),
      sessionKeypair.publicKey.toBytes(),
      provider.wallet.publicKey.toBytes(),
    ],
    sessionTokenManager.program.programId,
  )[0];
  console.log(
    "Session Signer Public Key: ",
    sessionKeypair.publicKey.toString(),
  );
  console.log("Session Token PDA: ", sessionTokenPDA.toString());

  (it("Create session on Solana", async () => {
    const start = Date.now();

    const topUp = true;
    const validUntilBN = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // valid for 1 hour
    // The sessionKeypair pays for: (a) rent-exempt minimum on its own system
    // account (~890,880 lamports), (b) tx fees on every session-signed tx, and
    // (c) the on-chain delegation buffer rent (~3M lamports) when it's the
    // delegate ix's payer. 0.005 SOL covers all three with headroom.
    const topUpLamportsBN = new anchor.BN(0.005 * LAMPORTS_PER_SOL);

    const tx = await sessionTokenManager.program.methods
      .createSessionV2(topUp, validUntilBN, topUpLamportsBN)
      .accounts({
        targetProgram: program.programId,
        sessionSigner: sessionKeypair.publicKey,
        feePayer: provider.wallet.publicKey,
        authority: provider.wallet.publicKey,
      })
      .transaction();
    tx.feePayer = provider.wallet.publicKey;

    const txHash = await sendAndConfirmTransaction(
      provider.connection,
      tx,
      [provider.wallet.payer!, sessionKeypair],
      {
        commitment: "confirmed",
      },
    );
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) CreateSession txHash: ${txHash}`);
  }),
    it("Initialize counter on Solana", async () => {
      const start = Date.now();
      let tx = await program.methods
        .initialize()
        .accounts({
          user: provider.wallet.publicKey,
        })
        .transaction();
      const txHash = await sendAndConfirmTransaction(
        provider.connection,
        tx,
        [provider.wallet.payer],
        {
          skipPreflight: true,
          commitment: "confirmed",
        },
      );
      const duration = Date.now() - start;
      console.log(`${duration}ms (Base Layer) Initialize txHash: ${txHash}`);
    }));

  it("Increase counter on Solana", async () => {
    const start = Date.now();
    let tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
        sessionToken: sessionTokenPDA,
        payer: sessionKeypair.publicKey,
      })
      .transaction();
    const txHash = await sendAndConfirmTransaction(
      provider.connection,
      tx,
      [sessionKeypair],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) Increment txHash: ${txHash}`);
  });

  it("Delegate counter to ER", async () => {
    const start = Date.now();
    // Validator identity for delegation: VALIDATOR env var wins; otherwise default to
    // local-ER validator iff the ER endpoint is localhost.
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
    let tx = await program.methods
      .delegate()
      .accounts({
        payer: sessionKeypair.publicKey,
        pda: counterPDA,
        sessionToken: sessionTokenPDA,
      })
      .remainingAccounts(remainingAccounts)
      .transaction();
    const txHash = await sendAndConfirmTransaction(
      provider.connection,
      tx,
      [sessionKeypair],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) Delegate txHash: ${txHash}`);
  });

  it("Increase counter on ER", async () => {
    const start = Date.now();
    let tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
        sessionToken: sessionTokenPDA,
        payer: sessionKeypair.publicKey,
      })
      .transaction();
    const txHash = await sendAndConfirmTransaction(
      providerEphemeralRollup.connection,
      tx,
      [sessionKeypair],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    const duration = Date.now() - start;
    console.log(`${duration}ms (ER) Increment txHash: ${txHash}`);
  });

  it("Commit counter state on ER to Solana", async () => {
    const start = Date.now();
    let tx = await program.methods
      .commit()
      .accounts({
        counter: counterPDA,
        sessionToken: sessionTokenPDA,
        payer: sessionKeypair.publicKey,
      })
      .transaction();
    const txHash = await sendAndConfirmTransaction(
      providerEphemeralRollup.connection,
      tx,
      [sessionKeypair],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
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
      .accounts({
        counter: counterPDA,
        sessionToken: sessionTokenPDA,
        payer: sessionKeypair.publicKey,
      })
      .transaction();
    const txHash = await sendAndConfirmTransaction(
      providerEphemeralRollup.connection,
      tx,
      [sessionKeypair],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    const duration = Date.now() - start;
    console.log(`${duration}ms (ER) Increment and Commit txHash: ${txHash}`);

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

  it("Increment and undelegate counter on ER to Solana", async () => {
    const start = Date.now();
    let tx = await program.methods
      .incrementAndUndelegate()
      .accounts({
        counter: counterPDA,
        sessionToken: sessionTokenPDA,
        payer: sessionKeypair.publicKey,
      })
      .transaction();
    const txHash = await sendAndConfirmTransaction(
      providerEphemeralRollup.connection,
      tx,
      [sessionKeypair],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    const duration = Date.now() - start;
    console.log(
      `${duration}ms (ER) Increment and Undelegate txHash: ${txHash}`,
    );

    // Get the commitment signature on the base layer
    const comfirmCommitStart = Date.now();
    // Await for the commitment on the base layer
    const txCommitSgn = await GetCommitmentSignature(
      txHash,
      providerEphemeralRollup.connection,
    );
    const commitDuration = Date.now() - comfirmCommitStart;
    console.log(
      `${commitDuration}ms (Base Layer) Undelegate txHash: ${txCommitSgn}`,
    );
  });
  it("Revoke session on Solana", async () => {
    const start = Date.now();

    const tx = await sessionTokenManager.program.methods
      .revokeSessionV2()
      .accounts({
        sessionToken: sessionTokenPDA,
        feePayer: provider.wallet.publicKey,
        authority: provider.wallet.publicKey,
      })
      .transaction();
    // While the session is still within `valid_until`, the program requires
    // `authority` to be a signer (see SessionError::InvalidAuthority). Sign
    // with the wallet (authority), not the session signer.
    tx.feePayer = provider.wallet.publicKey;
    const txHash = await sendAndConfirmTransaction(
      provider.connection,
      tx,
      [provider.wallet.payer!],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) revokeSession txHash: ${txHash}`);
  });
});
