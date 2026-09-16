import * as anchor from "@coral-xyz/anchor";
import { strict as assert } from "assert";
import {
  createCloseEscrowInstruction,
  createTopUpEscrowInstruction,
  escrowPdaFromEscrowAuthority,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  accountOwner,
  bootAnchorSvm,
  DELEGATION_PROGRAM_ID,
  isDelegated,
  readU64le,
  requireAccount,
  sendExpectingFailure,
  sendSvmIx,
} from "@magicblock-labs/test-utils";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { MagicActions } from "../target/types/magic_actions";

const COUNTER_SEED = "counter";
const SEED_LEADERBOARD = "leaderboard";

function failedBlob(result: {
  err(): unknown;
  meta(): { logs(): string[] };
  toString(): string;
}): string {
  const logs = result.meta().logs().join("\n");
  const err = JSON.stringify(result.err());
  const raw = `${result.toString()}\n${err}\n${logs}`;
  if (/SignatureFailure|signature/i.test(raw)) {
    return `signature verification failed\n${raw}`;
  }
  return raw;
}

describe("magic-actions-local", () => {
  const { svm, payer, program, validator } = bootAnchorSvm<MagicActions>({
    fromDir: __dirname,
    programName: "magic_actions",
    airdropLamports: BigInt(LAMPORTS_PER_SOL) * 10n,
  });
  const programId = program.programId;
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    programId,
  );
  const [leaderboardPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_LEADERBOARD)],
    programId,
  );
  const escrow = escrowPdaFromEscrowAuthority(payer.publicKey);
  const validatorKey = new PublicKey(validator);

  function printCounter(message: string) {
    const delegated = isDelegated(svm, pda);
    const highScore = readU64le(svm, leaderboardPda, "base");

    let counterBase = "<n/a>";
    let counterER = "<n/a>";
    if (delegated) {
      counterBase = "<Delegated>";
      const erInfo = svm.getAccountFor(pda, { target: "ephemeral" });
      counterER = erInfo.exists ? readU64le(svm, pda, "ephemeral").toString() : "0";
    } else if (svm.getAccountFor(pda, { target: "base" }).exists) {
      counterBase = readU64le(svm, pda, "base").toString();
      counterER = "<Not Delegated>";
    }
    console.log("--------------------------------");
    console.log(`| ${delegated ? "✅ Delegated" : "❌ Not Delegated"}`);
    console.log("--------------------------------");
    console.log("| Counter (Base): ", counterBase);
    console.log("| Counter (ER):   ", counterER);
    console.log("| High Score:     ", highScore.toString());
    console.log("--------------------------------");
    console.log(message);
  }

  it("Initialize Counter", async () => {
    const ix = await program.methods
      .initialize()
      .accounts({
        counter: pda,
        user: payer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .instruction();
    sendSvmIx(svm, [payer], ix, "base");
    requireAccount(svm, pda, "base", "counter");
    requireAccount(svm, leaderboardPda, "base", "leaderboard");
    assert.equal(readU64le(svm, pda, "base"), 0n);
    assert.equal(readU64le(svm, leaderboardPda, "base"), 0n);
    printCounter("✅ Initialized");
  });

  it("Increment Counter on base layer", async () => {
    const ix = await program.methods
      .increment()
      .accounts({ counter: pda })
      .instruction();
    sendSvmIx(svm, [payer], ix, "base");
    assert.equal(readU64le(svm, pda, "base"), 1n);
    console.log("✅ Incremented (base)");
  });

  it("Reject direct leaderboard updates", async () => {
    const ix = await program.methods
      .updateLeaderboard()
      .accounts({
        counter: pda,
        escrowAuth: payer.publicKey,
        escrow,
      })
      .instruction();
    const blob = failedBlob(sendExpectingFailure(svm, [payer], ix, "base"));
    assert.match(blob, /signature verification failed|unknown signer/i);
  });

  it("Reject an incorrect counter PDA", async () => {
    const invalidEscrow = anchor.web3.Keypair.generate();
    const ix = await program.methods
      .updateLeaderboard()
      .accounts({
        counter: leaderboardPda,
        escrowAuth: payer.publicKey,
        escrow: invalidEscrow.publicKey,
      })
      .instruction();
    const blob = failedBlob(
      sendExpectingFailure(svm, [payer, invalidEscrow], ix, "base"),
    );
    assert.match(blob, /Error Code: ConstraintSeeds/);
  });

  it("Reject an incorrect escrow PDA", async () => {
    const invalidEscrow = anchor.web3.Keypair.generate();
    const ix = await program.methods
      .updateLeaderboard()
      .accounts({
        counter: pda,
        escrowAuth: payer.publicKey,
        escrow: invalidEscrow.publicKey,
      })
      .instruction();
    const blob = failedBlob(
      sendExpectingFailure(svm, [payer, invalidEscrow], ix, "base"),
    );
    assert.match(blob, /Error Code: ConstraintAddress/);
  });

  it("Delegate Counter and create Escrow", async () => {
    const remainingAccounts = [
      { pubkey: validatorKey, isSigner: false, isWritable: false },
    ];
    const topUpIx = createTopUpEscrowInstruction(
      escrow,
      payer.publicKey,
      payer.publicKey,
      10000,
    );
    const delegateIx = await program.methods
      .delegate()
      .accounts({ payer: payer.publicKey, pda })
      .remainingAccounts(remainingAccounts)
      .instruction();
    sendSvmIx(svm, [payer], [topUpIx, delegateIx], "base");

    assert.equal(accountOwner(svm, pda, "base"), DELEGATION_PROGRAM_ID.toBase58());
    assert.ok(isDelegated(svm, pda));
    assert.equal(readU64le(svm, pda, "ephemeral"), 1n);
    const escrowAccount = requireAccount(svm, escrow, "base", "escrow");
    assert.ok(escrowAccount.lamports > 0n);
    console.log("✅ Delegated");
  });

  it("Increment Counter in ER", async () => {
    const ix = await program.methods
      .increment()
      .accounts({ counter: pda })
      .instruction();
    sendSvmIx(svm, [payer], ix, "ephemeral");
    assert.equal(readU64le(svm, pda, "ephemeral"), 2n);
    printCounter("✅ Incremented (ER)");
  });

  it("Update Leaderboard while delegated", async () => {
    const ix = await program.methods
      .commitAndUpdateLeaderboard()
      .accounts({
        payer: payer.publicKey,
        programId,
      } as any)
      .instruction();
    sendSvmIx(svm, [payer], ix, "ephemeral");

    const highScore = readU64le(svm, leaderboardPda, "base");
    const erCount = readU64le(svm, pda, "ephemeral");
    assert.equal(
      highScore,
      erCount,
      "post-commit magic action must update the base leaderboard from the committed counter",
    );
    printCounter("✅ Updated leaderboard while delegated");
  });

  it("Undelegate Counter", async () => {
    const ix = await program.methods
      .undelegate()
      .accounts({ payer: payer.publicKey })
      .instruction();
    sendSvmIx(svm, [payer], ix, "ephemeral");
    assert.equal(accountOwner(svm, pda, "base"), programId.toBase58());
    assert.equal(readU64le(svm, pda, "base"), 2n);
    printCounter("✅ Undelegated");
  });

  it("Close Escrow", async () => {
    const ix = createCloseEscrowInstruction(escrow, payer.publicKey);
    sendSvmIx(svm, [payer], ix, "base");
    const escrowAccount = svm.getAccountFor(escrow, { target: "base" });
    assert.ok(
      !escrowAccount.exists || escrowAccount.lamports === 0n,
      "escrow should be closed",
    );
    console.log("✅ Escrow closed");
  });
});
