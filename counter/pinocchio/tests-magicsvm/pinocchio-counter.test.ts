import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import * as borsh from "borsh";
import * as path from "path";
import {
  CounterInstruction,
  IncreaseCounterPayload,
} from "../tests/web3js/schema";
import {
  DELEGATION_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  createSvm,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  isDelegated,
  programIdFromKeypairFile,
  readU64le,
  requireAccount,
  sendSvmIx,
} from "@magicblock-labs/test-utils";
import { describe, it, expect } from "vitest";

const LAMPORTS_PER_SOL = 1_000_000_000n;
const PROGRAM_SO = path.join("target", "deploy", "pinocchio_counter.so");
const PROGRAM_KEYPAIR = path.join(
  "target",
  "deploy",
  "pinocchio_counter-keypair.json",
);

function send(
  svm: ReturnType<typeof createSvm>["svm"],
  target: "base" | "ephemeral",
  ix: TransactionInstruction,
  payer: Keypair,
) {
  return sendSvmIx(svm, [payer], ix, target);
}

describe("pinocchio-counter magicsvm", () => {
  const PROGRAM_ID = new PublicKey(programIdFromKeypairFile(PROGRAM_KEYPAIR));
  const userKeypair = Keypair.generate();
  const { svm } = createSvm({
    programs: [{ id: PROGRAM_ID, so: PROGRAM_SO }],
    airdrops: [
      { address: userKeypair.publicKey, lamports: 2n * LAMPORTS_PER_SOL },
    ],
  });
  const [counterPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), userKeypair.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const bumpBytes = Buffer.from([bump]);

  it("Initialize counter on Solana", () => {
    const keys = [
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
    ];
    const serializedInstructionData = Buffer.concat([
      Buffer.from(CounterInstruction.InitializeCounter, "hex"),
      bumpBytes,
    ]);
    const result = send(
      svm,
      "base",
      new TransactionInstruction({
        keys,
        programId: PROGRAM_ID,
        data: serializedInstructionData,
      }),
      userKeypair,
    );
    expect(result).toBeDefined();

    const account = requireAccount(svm, counterPda, "base");
    expect(account.programAddress.toString()).toBe(PROGRAM_ID.toBase58());
    expect(account.data.length).toBe(8);
    expect(readU64le(svm, counterPda, "base", 0)).toBe(0n);
  });

  it("Increase counter on Solana", () => {
    const keys = [
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
    ];
    const serializedInstructionData = Buffer.concat([
      Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
      bumpBytes,
      borsh.serialize(
        IncreaseCounterPayload.schema,
        new IncreaseCounterPayload(1),
      ),
    ]);
    const result = send(
      svm,
      "base",
      new TransactionInstruction({
        keys,
        programId: PROGRAM_ID,
        data: serializedInstructionData,
      }),
      userKeypair,
    );
    expect(result).toBeDefined();
    expect(readU64le(svm, counterPda, "base", 0)).toBe(1n);
  });

  it("Delegate counter to ER", () => {
    const remainingAccounts = [
      {
        pubkey: new PublicKey(svm.validatorIdentity().toString()),
        isSigner: false,
        isWritable: false,
      },
    ];
    const keys = [
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
      ...remainingAccounts,
    ];
    const serializedInstructionData = Buffer.concat([
      Buffer.from(CounterInstruction.Delegate, "hex"),
      bumpBytes,
    ]);
    const result = send(
      svm,
      "base",
      new TransactionInstruction({
        keys,
        programId: PROGRAM_ID,
        data: serializedInstructionData,
      }),
      userKeypair,
    );
    expect(result).toBeDefined();
    expect(isDelegated(svm, counterPda)).toBe(true);
  });

  it("Increase counter on ER (1)", () => {
    const keys = [
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
    ];
    const serializedInstructionData = Buffer.concat([
      Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
      bumpBytes,
      borsh.serialize(
        IncreaseCounterPayload.schema,
        new IncreaseCounterPayload(1),
      ),
    ]);
    const result = send(
      svm,
      "ephemeral",
      new TransactionInstruction({
        keys,
        programId: PROGRAM_ID,
        data: serializedInstructionData,
      }),
      userKeypair,
    );
    expect(result).toBeDefined();
    expect(readU64le(svm, counterPda, "ephemeral", 0)).toBe(2n);
  });

  it("Commit counter state on ER to Solana", () => {
    const keys = [
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
    ];
    const serializedInstructionData = Buffer.from(
      CounterInstruction.Commit,
      "hex",
    );
    const result = send(
      svm,
      "ephemeral",
      new TransactionInstruction({
        keys,
        programId: PROGRAM_ID,
        data: serializedInstructionData,
      }),
      userKeypair,
    );
    expect(result).toBeDefined();
    expect(readU64le(svm, counterPda, "base", 0)).toBe(2n);
  });

  it("Increase counter on ER (2)", () => {
    const keys = [
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
    ];
    const serializedInstructionData = Buffer.concat([
      Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
      bumpBytes,
      borsh.serialize(
        IncreaseCounterPayload.schema,
        new IncreaseCounterPayload(1),
      ),
    ]);
    const result = send(
      svm,
      "ephemeral",
      new TransactionInstruction({
        keys,
        programId: PROGRAM_ID,
        data: serializedInstructionData,
      }),
      userKeypair,
    );
    expect(result).toBeDefined();
    expect(readU64le(svm, counterPda, "ephemeral", 0)).toBe(3n);
  });

  it("Commit and undelegate counter on ER to Solana", () => {
    const keys = [
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
    ];
    const serializedInstructionData = Buffer.from(
      CounterInstruction.CommitAndUndelegate,
      "hex",
    );
    const result = send(
      svm,
      "ephemeral",
      new TransactionInstruction({
        keys,
        programId: PROGRAM_ID,
        data: serializedInstructionData,
      }),
      userKeypair,
    );
    expect(result).toBeDefined();

    const account = requireAccount(svm, counterPda, "base");
    expect(account.programAddress.toString()).toBe(PROGRAM_ID.toBase58());
    expect(readU64le(svm, counterPda, "base", 0)).toBe(3n);
  });
});
