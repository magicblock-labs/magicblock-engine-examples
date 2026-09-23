import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { MagicSVM } from "@magicblock-labs/magicsvm";
import {
  createCommitAndUndelegateInstruction,
  createCommitInstruction,
  createDelegateInstruction,
  DELEGATION_PROGRAM_ID,
  airdropOrThrow,
  isDelegated,
  sendExpectingFailure,
  sendSvmIx,
  validatorPubkey,
} from "@magicblock-labs/test-utils";
import { describe, expect, it } from "vitest";

const ownerProgram = SystemProgram.programId;

describe("on-curve-delegation-magicsvm", () => {
  const svm = new MagicSVM();
  const userKeypair = Keypair.generate();
  const feePayerKeypair = Keypair.generate();
  const userPubkey = userKeypair.publicKey;
  const feePayerPubkey = feePayerKeypair.publicKey;
  const validator = new PublicKey(validatorPubkey(svm));

  airdropOrThrow(svm, userPubkey, BigInt(2 * LAMPORTS_PER_SOL), "user airdrop");
  airdropOrThrow(
    svm,
    feePayerPubkey,
    BigInt(LAMPORTS_PER_SOL),
    "fee payer airdrop",
  );

  it("Assign owner + Delegate on-curve account", () => {
    const assignInstruction = SystemProgram.assign({
      accountPubkey: userPubkey,
      programId: DELEGATION_PROGRAM_ID,
    });
    const delegateInstruction = createDelegateInstruction({
      payer: feePayerPubkey,
      delegatedAccount: userPubkey,
      ownerProgram,
      validator,
    });

    sendSvmIx(
      svm,
      [feePayerKeypair, userKeypair],
      [assignInstruction, delegateInstruction],
      "base",
      "delegate",
    );

    const base = svm.getAccount(userPubkey);
    expect(base.exists).toBe(true);
    if (!base.exists) {
      throw new Error("delegated account missing on base");
    }
    expect(isDelegated(svm, userPubkey)).toBe(true);

    const ephemeral = svm.getAccountFor(userPubkey, { target: "ephemeral" });
    expect(ephemeral.exists).toBe(true);
  });

  it("Commit on-curve account", () => {
    const commitInstruction = createCommitInstruction(userPubkey, [userPubkey]);
    sendSvmIx(
      svm,
      [feePayerKeypair, userKeypair],
      [commitInstruction],
      "ephemeral",
      "commit",
    );

    const base = svm.getAccount(userPubkey);
    const ephemeral = svm.getAccountFor(userPubkey, { target: "ephemeral" });
    expect(base.exists).toBe(true);
    expect(ephemeral.exists).toBe(true);
  });

  it("Commit and undelegate on-curve account", () => {
    const commitAndUndelegateInstruction = createCommitAndUndelegateInstruction(
      userPubkey,
      [userPubkey],
    );
    sendSvmIx(
      svm,
      [feePayerKeypair, userKeypair],
      [commitAndUndelegateInstruction],
      "ephemeral",
      "commit-and-undelegate",
    );

    const base = svm.getAccount(userPubkey);
    expect(base.exists).toBe(true);

    sendExpectingFailure(
      svm,
      [feePayerKeypair, userKeypair],
      SystemProgram.allocate({
        accountPubkey: userPubkey,
        space: 8,
      }),
      "ephemeral",
    );
  });
});
