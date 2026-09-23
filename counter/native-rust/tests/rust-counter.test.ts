import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as borsh from "borsh";
import bs58 from "bs58";
import { CounterInstruction, IncreaseCounterPayload } from "./schema";
import {
  MagicSVM,
  TransactionMetadata,
  type TransactionTarget,
} from "@magicblock-labs/magicsvm";
import {
  DELEGATION_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  accountOwner,
  createSvm,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  isDelegated,
  programIdFromKeypairFile,
  readU64le,
  sendSvmTx,
} from "@magicblock-labs/test-utils";
import { describe, it, beforeAll, expect } from "vitest";

const PROGRAM_SO_PATH = "target/deploy/rust_counter.so";
const PROGRAM_KEYPAIR_PATH = "target/deploy/rust_counter-keypair.json";

function readCounter(
  svm: MagicSVM,
  counterPda: PublicKey,
  target: TransactionTarget,
): bigint {
  return readU64le(svm, counterPda, target, 0);
}

function signatureOf(meta: TransactionMetadata): string {
  return bs58.encode(Buffer.from(meta.signature()));
}

function signAndSend(
  svm: MagicSVM,
  tx: Transaction,
  signers: Keypair[],
  target: TransactionTarget,
): TransactionMetadata {
  return sendSvmTx(svm, signers, tx, target);
}

function initializeCounterIx(
  programId: PublicKey,
  user: PublicKey,
  counterPda: PublicKey,
) {
  return new TransactionInstruction({
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: counterPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.from(CounterInstruction.InitializeCounter, "hex"),
  });
}

function increaseCounterIx(
  programId: PublicKey,
  user: PublicKey,
  counterPda: PublicKey,
  increaseBy: number,
) {
  return new TransactionInstruction({
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: counterPda, isSigner: false, isWritable: true },
    ],
    programId,
    data: Buffer.concat([
      Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
      Buffer.from(
        borsh.serialize(
          IncreaseCounterPayload.schema,
          new IncreaseCounterPayload(increaseBy),
        ),
      ),
    ]),
  });
}

function delegateCounterIx(
  programId: PublicKey,
  user: PublicKey,
  counterPda: PublicKey,
  validator: PublicKey,
) {
  return new TransactionInstruction({
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: counterPda, isSigner: false, isWritable: true },
      { pubkey: programId, isSigner: false, isWritable: false },
      {
        pubkey: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
          counterPda,
          programId,
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
      { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: validator, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.from(CounterInstruction.Delegate, "hex"),
  });
}

function commitStyleIx(
  programId: PublicKey,
  user: PublicKey,
  counterPda: PublicKey,
  discriminator: CounterInstruction,
  increaseBy?: number,
) {
  const data =
    increaseBy === undefined
      ? Buffer.from(discriminator, "hex")
      : Buffer.concat([
          Buffer.from(discriminator, "hex"),
          Buffer.from(
            borsh.serialize(
              IncreaseCounterPayload.schema,
              new IncreaseCounterPayload(increaseBy),
            ),
          ),
        ]);
  return new TransactionInstruction({
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: counterPda, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
    ],
    programId,
    data,
  });
}

function bootCounterSvm(programId: PublicKey, user: Keypair): MagicSVM {
  return createSvm({
    programs: [{ id: programId, so: PROGRAM_SO_PATH }],
    airdrops: [
      {
        address: user.publicKey,
        lamports: BigInt(2 * LAMPORTS_PER_SOL),
        label: "airdrop",
      },
    ],
  }).svm;
}

describe("basic-test", () => {
  const PROGRAM_ID = new PublicKey(
    programIdFromKeypairFile(PROGRAM_KEYPAIR_PATH),
  );
  const userKeypair = Keypair.generate();
  const [counterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), userKeypair.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  let svm: MagicSVM;
  let validatorPubkey: PublicKey;

  beforeAll(() => {
    svm = bootCounterSvm(PROGRAM_ID, userKeypair);
    validatorPubkey = new PublicKey(svm.validatorIdentity().toString());
    console.log("Program ID: ", PROGRAM_ID.toString());
    console.log("Counter PDA: ", counterPda.toString());
    console.log("Validator identity: ", validatorPubkey.toString());
  });

  it("Initialize counter on Solana", () => {
    const start = Date.now();
    const tx = new Transaction().add(
      initializeCounterIx(PROGRAM_ID, userKeypair.publicKey, counterPda),
    );
    const meta = signAndSend(svm, tx, [userKeypair], "base");
    const txHash = signatureOf(meta);
    console.log(
      `${Date.now() - start}ms (Base Layer) Initialize txHash: ${txHash}`,
    );
    expect(txHash).toBeDefined();
    expect(readCounter(svm, counterPda, "base")).toBe(0n);
  });

  it("Increase counter on Solana", () => {
    const start = Date.now();
    const tx = new Transaction().add(
      increaseCounterIx(PROGRAM_ID, userKeypair.publicKey, counterPda, 1),
    );
    const meta = signAndSend(svm, tx, [userKeypair], "base");
    const txHash = signatureOf(meta);
    console.log(
      `${Date.now() - start}ms (Base Layer) Increment txHash: ${txHash}`,
    );
    expect(txHash).toBeDefined();
    expect(readCounter(svm, counterPda, "base")).toBe(1n);
  });

  it("Delegate counter to ER", () => {
    const start = Date.now();
    const tx = new Transaction().add(
      delegateCounterIx(
        PROGRAM_ID,
        userKeypair.publicKey,
        counterPda,
        validatorPubkey,
      ),
    );
    const meta = signAndSend(svm, tx, [userKeypair], "base");
    const txHash = signatureOf(meta);
    console.log(
      `${Date.now() - start}ms (Base Layer) Delegate txHash: ${txHash}`,
    );
    expect(txHash).toBeDefined();
    expect(isDelegated(svm, counterPda)).toBe(true);
    expect(readCounter(svm, counterPda, "ephemeral")).toBe(1n);
  });

  it("Increase counter on ER (1)", () => {
    const start = Date.now();
    const tx = new Transaction().add(
      increaseCounterIx(PROGRAM_ID, userKeypair.publicKey, counterPda, 1),
    );
    const meta = signAndSend(svm, tx, [userKeypair], "ephemeral");
    const txHash = signatureOf(meta);
    console.log(`${Date.now() - start}ms (ER) Increment txHash: ${txHash}`);
    expect(txHash).toBeDefined();
    expect(readCounter(svm, counterPda, "ephemeral")).toBe(2n);
  });

  it("Commit counter state on ER to Solana", () => {
    const start = Date.now();
    const tx = new Transaction().add(
      commitStyleIx(
        PROGRAM_ID,
        userKeypair.publicKey,
        counterPda,
        CounterInstruction.Commit,
      ),
    );
    const meta = signAndSend(svm, tx, [userKeypair], "ephemeral");
    const txHash = signatureOf(meta);
    console.log(`${Date.now() - start}ms (ER) Commit txHash: ${txHash}`);
    expect(txHash).toBeDefined();
    expect(readCounter(svm, counterPda, "base")).toBe(2n);
    expect(isDelegated(svm, counterPda)).toBe(true);
  });

  it("Increase counter on ER (2)", () => {
    const start = Date.now();
    const tx = new Transaction().add(
      increaseCounterIx(PROGRAM_ID, userKeypair.publicKey, counterPda, 1),
    );
    const meta = signAndSend(svm, tx, [userKeypair], "ephemeral");
    const txHash = signatureOf(meta);
    console.log(`${Date.now() - start}ms (ER) Increment txHash: ${txHash}`);
    expect(txHash).toBeDefined();
    expect(readCounter(svm, counterPda, "ephemeral")).toBe(3n);
  });

  it("Commit and undelegate counter on ER to Solana", () => {
    const start = Date.now();
    const tx = new Transaction().add(
      commitStyleIx(
        PROGRAM_ID,
        userKeypair.publicKey,
        counterPda,
        CounterInstruction.CommitAndUndelegate,
      ),
    );
    const meta = signAndSend(svm, tx, [userKeypair], "ephemeral");
    const txHash = signatureOf(meta);
    console.log(`${Date.now() - start}ms (ER) Undelegate txHash: ${txHash}`);
    expect(txHash).toBeDefined();
    expect(readCounter(svm, counterPda, "base")).toBe(3n);
    expect(accountOwner(svm, counterPda, "base")).toBe(PROGRAM_ID.toString());
  });
});

describe("increment-and-commit-cpi", () => {
  const PROGRAM_ID = new PublicKey(
    programIdFromKeypairFile(PROGRAM_KEYPAIR_PATH),
  );
  const userKeypair = Keypair.generate();
  const [counterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), userKeypair.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  let svm: MagicSVM;
  let validatorPubkey: PublicKey;

  beforeAll(() => {
    svm = bootCounterSvm(PROGRAM_ID, userKeypair);
    validatorPubkey = new PublicKey(svm.validatorIdentity().toString());
  });

  it("Initialize counter on Solana", () => {
    const meta = signAndSend(
      svm,
      new Transaction().add(
        initializeCounterIx(PROGRAM_ID, userKeypair.publicKey, counterPda),
      ),
      [userKeypair],
      "base",
    );
    expect(signatureOf(meta)).toBeDefined();
    expect(readCounter(svm, counterPda, "base")).toBe(0n);
  });

  it("Delegate counter to ER", () => {
    const meta = signAndSend(
      svm,
      new Transaction().add(
        delegateCounterIx(
          PROGRAM_ID,
          userKeypair.publicKey,
          counterPda,
          validatorPubkey,
        ),
      ),
      [userKeypair],
      "base",
    );
    expect(signatureOf(meta)).toBeDefined();
    expect(isDelegated(svm, counterPda)).toBe(true);
  });

  it("Increase delegated counter and commit through CPI", () => {
    const start = Date.now();
    const tx = new Transaction().add(
      commitStyleIx(
        PROGRAM_ID,
        userKeypair.publicKey,
        counterPda,
        CounterInstruction.IncrementAndCommit,
        1,
      ),
    );
    const meta = signAndSend(svm, tx, [userKeypair], "ephemeral");
    const txHash = signatureOf(meta);
    console.log(
      `${Date.now() - start}ms (ER) Increment And Commit txHash: ${txHash}`,
    );
    expect(txHash).toBeDefined();
    expect(readCounter(svm, counterPda, "ephemeral")).toBe(1n);
    expect(readCounter(svm, counterPda, "base")).toBe(1n);
    expect(isDelegated(svm, counterPda)).toBe(true);
  });

  it("Increase delegated counter and undelegate through CPI", () => {
    const start = Date.now();
    const tx = new Transaction().add(
      commitStyleIx(
        PROGRAM_ID,
        userKeypair.publicKey,
        counterPda,
        CounterInstruction.IncrementAndUndelegate,
        1,
      ),
    );
    const meta = signAndSend(svm, tx, [userKeypair], "ephemeral");
    const txHash = signatureOf(meta);
    console.log(
      `${Date.now() - start}ms (ER) Increment and Undelegate txHash: ${txHash}`,
    );
    expect(txHash).toBeDefined();
    expect(readCounter(svm, counterPda, "base")).toBe(2n);
    expect(accountOwner(svm, counterPda, "base")).toBe(PROGRAM_ID.toString());
  });
});
