import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import {
  accountOwner,
  bootAnchorSvm,
  isDelegated,
  readU64le,
  sendSvmTx,
  setUnixTimestamp,
  validatorRemainingAccount,
} from "@magicblock-labs/test-utils";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import assert from "assert";
import * as path from "path";
import { AnchorCounterSession } from "../target/types/anchor_counter_session";

const COUNTER_SEED = "counter";
const SESSION_TOKEN_SEED = "session_token_v2";
const SESSION_PROGRAM_ID = "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5";

describe("anchor-counter-session magicsvm", () => {
  const sessionKeypair = web3.Keypair.generate();
  const { svm, payer, program, validator } =
    bootAnchorSvm<AnchorCounterSession>({
      fromDir: __dirname,
      programName: "anchor_counter_session",
      airdropLamports: BigInt(2 * LAMPORTS_PER_SOL),
      extraPrograms: [
        {
          id: new PublicKey(SESSION_PROGRAM_ID),
          so: path.resolve(__dirname, "fixtures", "session-keys.so"),
        },
      ],
    });
  setUnixTimestamp(svm);

  const [counterPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED), payer.publicKey.toBuffer()],
    program.programId,
  );

  const sessionTokenManager = new SessionTokenManager(
    new anchor.Wallet(web3.Keypair.fromSecretKey(payer.secretKey)),
    new web3.Connection("http://127.0.0.1:8899"),
  );
  const sessionTokenPDA = web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(SESSION_TOKEN_SEED),
      program.programId.toBytes(),
      sessionKeypair.publicKey.toBytes(),
      payer.publicKey.toBytes(),
    ],
    sessionTokenManager.program.programId,
  )[0];

  console.log("Program ID: ", program.programId.toString());
  console.log("Counter PDA: ", counterPDA.toString());
  console.log(
    "Session Signer Public Key: ",
    sessionKeypair.publicKey.toString(),
  );
  console.log("Session Token PDA: ", sessionTokenPDA.toString());
  console.log("Validator identity: ", validator.toString());

  it("Create session on Solana", async () => {
    const topUp = true;
    const validUntilBN = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
    const topUpLamportsBN = new anchor.BN(0.005 * LAMPORTS_PER_SOL);

    const tx = await sessionTokenManager.program.methods
      .createSessionV2(topUp, validUntilBN, topUpLamportsBN)
      .accounts({
        targetProgram: program.programId,
        sessionSigner: sessionKeypair.publicKey,
        feePayer: payer.publicKey,
        authority: payer.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [payer, sessionKeypair], tx, "base", "createSessionV2");

    const sessionAccount = svm.getAccount(sessionTokenPDA);
    assert.ok(sessionAccount.exists, "session token missing on base");
    assert.equal(
      sessionAccount.programAddress.toString(),
      sessionTokenManager.program.programId.toString(),
    );
  });

  it("Initialize counter on Solana", async () => {
    const tx = await program.methods
      .initialize()
      .accounts({
        user: payer.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "base", "initialize");
    assert.equal(readU64le(svm, counterPDA, "base", 40), 0n);
  });

  it("Increase counter on Solana", async () => {
    const tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
        sessionToken: sessionTokenPDA,
        payer: sessionKeypair.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [sessionKeypair], tx, "base", "increment (base)");
    assert.equal(readU64le(svm, counterPDA, "base", 40), 1n);
  });

  it("Delegate counter to ER", async () => {
    const tx = await program.methods
      .delegate()
      .accounts({
        payer: sessionKeypair.publicKey,
        pda: counterPDA,
        sessionToken: sessionTokenPDA,
      })
      .remainingAccounts([validatorRemainingAccount(svm)])
      .transaction();
    sendSvmTx(svm, [sessionKeypair], tx, "base", "delegate");
    assert.ok(isDelegated(svm, counterPDA));
  });

  it("Increase counter on ER", async () => {
    const tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
        sessionToken: sessionTokenPDA,
        payer: sessionKeypair.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [sessionKeypair], tx, "ephemeral", "increment (ER)");
    assert.equal(readU64le(svm, counterPDA, "ephemeral", 40), 2n);
  });

  it("Commit counter state on ER to Solana", async () => {
    const tx = await program.methods
      .commit()
      .accounts({
        counter: counterPDA,
        sessionToken: sessionTokenPDA,
        payer: sessionKeypair.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [sessionKeypair], tx, "ephemeral", "commit");
    assert.equal(readU64le(svm, counterPDA, "base", 40), 2n);
    assert.ok(isDelegated(svm, counterPDA));
  });

  it("Increase counter on ER and commit", async () => {
    const tx = await program.methods
      .incrementAndCommit()
      .accounts({
        counter: counterPDA,
        sessionToken: sessionTokenPDA,
        payer: sessionKeypair.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [sessionKeypair], tx, "ephemeral", "incrementAndCommit");
    assert.equal(readU64le(svm, counterPDA, "ephemeral", 40), 3n);
    assert.equal(readU64le(svm, counterPDA, "base", 40), 3n);
  });

  it("Increment and undelegate counter on ER to Solana", async () => {
    const tx = await program.methods
      .incrementAndUndelegate()
      .accounts({
        counter: counterPDA,
        sessionToken: sessionTokenPDA,
        payer: sessionKeypair.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [sessionKeypair], tx, "ephemeral", "incrementAndUndelegate");
    assert.equal(readU64le(svm, counterPDA, "base", 40), 4n);
    assert.equal(
      accountOwner(svm, counterPDA, "base"),
      program.programId.toString(),
    );
  });

  it("Revoke session on Solana", async () => {
    const tx = await sessionTokenManager.program.methods
      .revokeSessionV2()
      .accounts({
        sessionToken: sessionTokenPDA,
        feePayer: payer.publicKey,
        authority: payer.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "base", "revokeSessionV2");
    const sessionAccount = svm.getAccount(sessionTokenPDA);
    assert.equal(sessionAccount.exists, false);
  });
});
