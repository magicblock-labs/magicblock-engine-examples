import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import path from "path";
import { MagicSVM, TransactionMetadata } from "@magicblock-labs/magicsvm";
import {
  airdropOrThrow,
  DELEGATION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  EPHEMERAL_VAULT_ID,
  isDelegated,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  permissionPdaFromAccount,
  programIdFromKeypairFile,
  requireAccount,
  sendSvmIx,
} from "@magicblock-labs/test-utils";
import { describe, it, beforeAll, expect } from "vitest";

const LAMPORTS_PER_SOL = 1_000_000_000n;
const PROGRAM_SO = path.join(
  __dirname,
  "..",
  "target",
  "deploy",
  "pinocchio_private_counter.so",
);
const PROGRAM_KEYPAIR = path.join(
  __dirname,
  "..",
  "target",
  "deploy",
  "pinocchio_private_counter-keypair.json",
);

function send(
  svm: MagicSVM,
  target: "base" | "ephemeral",
  ix: TransactionInstruction,
  payer: Keypair,
): TransactionMetadata {
  return sendSvmIx(svm, [payer], ix, target);
}

function counterCount(data: Uint8Array): Uint8Array {
  return Buffer.from(data.subarray(32, 40));
}

describe("pinocchio-private-counter magicsvm", () => {
  const PROGRAM_ID = new PublicKey(programIdFromKeypairFile(PROGRAM_KEYPAIR));
  const userKeypair = Keypair.generate();
  const unauthorizedKeypair = Keypair.generate();
  const svm = new MagicSVM();
  const id = Keypair.generate().publicKey;

  const [counterPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), id.toBuffer()],
    PROGRAM_ID,
  );
  const permissionPda = permissionPdaFromAccount(counterPda);

  beforeAll(() => {
    svm.addProgramFromFile(PROGRAM_ID, PROGRAM_SO);
    airdropOrThrow(svm, userKeypair.publicKey, 2n * LAMPORTS_PER_SOL);
    console.log("Program ID: ", PROGRAM_ID.toString());
    console.log("Counter PDA: ", counterPda.toString());
    console.log("Bump: ", bump);
    console.log("Permission PDA: ", permissionPda.toString());
    console.log("Validator identity: ", svm.validatorIdentity().toString());
  });

  it("Initialize counter on Solana", () => {
    const ixData = Buffer.concat([
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
      id.toBuffer(),
    ]);
    const result = send(
      svm,
      "base",
      new TransactionInstruction({
        programId: PROGRAM_ID,
        data: ixData,
        keys: [
          {
            pubkey: userKeypair.publicKey,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: counterPda,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
      }),
      userKeypair,
    );
    expect(result).toBeDefined();

    const counter = requireAccount(svm, counterPda, "base");
    expect(counterCount(counter.data)).toEqual(
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
    );
  });

  it("Increase counter on Solana", () => {
    const ixData = Buffer.concat([
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
    ]);
    const result = send(
      svm,
      "base",
      new TransactionInstruction({
        programId: PROGRAM_ID,
        data: ixData,
        keys: [
          {
            pubkey: counterPda,
            isSigner: false,
            isWritable: true,
          },
        ],
      }),
      userKeypair,
    );
    expect(result).toBeDefined();

    const counter = requireAccount(svm, counterPda, "base");
    expect(counterCount(counter.data)).toEqual(
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
    );
  });

  it("Delegate counter to ER", () => {
    const ixData = Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]);
    const result = send(
      svm,
      "base",
      new TransactionInstruction({
        programId: PROGRAM_ID,
        data: ixData,
        keys: [
          {
            pubkey: userKeypair.publicKey,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: counterPda,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
              counterPda,
              PROGRAM_ID,
            ),
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: delegationRecordPdaFromDelegatedAccount(counterPda),
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: delegationMetadataPdaFromDelegatedAccount(counterPda),
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: DELEGATION_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: new PublicKey(svm.validatorIdentity().toString()),
            isSigner: false,
            isWritable: false,
          },
        ],
      }),
      userKeypair,
    );
    expect(result).toBeDefined();
    expect(isDelegated(svm, counterPda)).toBe(true);
  });

  it("Increase counter on ER", () => {
    const ixData = Buffer.concat([
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
    ]);
    const result = send(
      svm,
      "ephemeral",
      new TransactionInstruction({
        programId: PROGRAM_ID,
        data: ixData,
        keys: [
          {
            pubkey: counterPda,
            isSigner: false,
            isWritable: true,
          },
        ],
      }),
      userKeypair,
    );
    expect(result).toBeDefined();

    const counter = requireAccount(svm, counterPda, "ephemeral");
    expect(counterCount(counter.data)).toEqual(
      Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]),
    );
  });

  it("Create permission on ER", () => {
    const ixData = Buffer.from([4, 0, 0, 0, 0, 0, 0, 0]);
    const result = send(
      svm,
      "ephemeral",
      new TransactionInstruction({
        programId: PROGRAM_ID,
        data: ixData,
        keys: [
          {
            pubkey: userKeypair.publicKey,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: counterPda,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: PERMISSION_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: permissionPda,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: MAGIC_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: EPHEMERAL_VAULT_ID,
            isSigner: false,
            isWritable: true,
          },
        ],
      }),
      userKeypair,
    );
    expect(result).toBeDefined();

    svm.setAuthorizedUser(userKeypair.publicKey);
    const authorized = requireAccount(svm, counterPda, "ephemeral");
    expect(counterCount(authorized.data)).toEqual(
      Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]),
    );
    svm.setAuthorizedUser(unauthorizedKeypair.publicKey);
    expect(svm.getAccountFor(counterPda, { target: "ephemeral" }).exists).toBe(
      false,
    );
    svm.setAuthorizedUser(null);
    expect(svm.getAccountFor(counterPda, { target: "ephemeral" }).exists).toBe(
      false,
    );

    const permission = requireAccount(svm, permissionPda, "ephemeral");
    expect(Buffer.from(permission.data.subarray(36, 68))).toEqual(
      PROGRAM_ID.toBuffer(),
    );
    expect(Buffer.from(permission.data.subarray(69, 101))).toEqual(
      userKeypair.publicKey.toBuffer(),
    );
  });

  it("Update permission on ER", () => {
    const ixData = Buffer.from([5, 0, 0, 0, 0, 0, 0, 0]);
    const result = send(
      svm,
      "ephemeral",
      new TransactionInstruction({
        programId: PROGRAM_ID,
        data: ixData,
        keys: [
          {
            pubkey: userKeypair.publicKey,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: counterPda,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: PERMISSION_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: permissionPda,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: MAGIC_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: EPHEMERAL_VAULT_ID,
            isSigner: false,
            isWritable: true,
          },
        ],
      }),
      userKeypair,
    );
    expect(result).toBeDefined();

    const permission = requireAccount(svm, permissionPda, "ephemeral");
    expect(Buffer.from(permission.data.subarray(36, 68))).toEqual(
      PROGRAM_ID.toBuffer(),
    );
    expect(permission.data.length).toEqual(68);

    svm.setAuthorizedUser(userKeypair.publicKey);
    expect(svm.getAccountFor(counterPda, { target: "ephemeral" }).exists).toBe(
      false,
    );
    svm.setAuthorizedUser(unauthorizedKeypair.publicKey);
    expect(svm.getAccountFor(counterPda, { target: "ephemeral" }).exists).toBe(
      false,
    );
  });

  it("Close permission on ER", () => {
    const ixData = Buffer.from([6, 0, 0, 0, 0, 0, 0, 0]);
    const result = send(
      svm,
      "ephemeral",
      new TransactionInstruction({
        programId: PROGRAM_ID,
        data: ixData,
        keys: [
          {
            pubkey: userKeypair.publicKey,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: counterPda,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: PERMISSION_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: permissionPda,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: MAGIC_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: EPHEMERAL_VAULT_ID,
            isSigner: false,
            isWritable: true,
          },
        ],
      }),
      userKeypair,
    );
    expect(result).toBeDefined();

    svm.setAuthorizedUser(userKeypair.publicKey);
    const counter = requireAccount(svm, counterPda, "ephemeral");
    expect(counterCount(counter.data)).toEqual(
      Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]),
    );
    svm.setAuthorizedUser(unauthorizedKeypair.publicKey);
    const unauthorized = requireAccount(svm, counterPda, "ephemeral");
    expect(counterCount(unauthorized.data)).toEqual(
      Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]),
    );
  });

  it("Commit and undelegate counter on ER to Solana", () => {
    const ixData = Buffer.from([3, 0, 0, 0, 0, 0, 0, 0]);
    const result = send(
      svm,
      "ephemeral",
      new TransactionInstruction({
        programId: PROGRAM_ID,
        data: ixData,
        keys: [
          {
            pubkey: userKeypair.publicKey,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: counterPda,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: MAGIC_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: MAGIC_CONTEXT_ID,
            isSigner: false,
            isWritable: true,
          },
        ],
      }),
      userKeypair,
    );
    expect(result).toBeDefined();

    const counter = requireAccount(svm, counterPda, "base");
    expect(counter.programAddress.toString()).toBe(PROGRAM_ID.toString());
  });
});
