import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as borsh from "borsh";
import * as fs from "fs";
import { CounterInstruction, IncreaseCounterPayload } from "./schema";
import {
  DELEGATION_PROGRAM_ID,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";

import { describe, it, beforeAll } from "vitest";

import dotenv from "dotenv";
import { FailedTransactionMetadata, MagicSVM } from "@magicblock-labs/magicsvm";
import {
  addressFromWeb3PublicKey,
  signerFromWeb3Keypair,
  transactionFromWeb3Transaction,
} from "test-utils";
dotenv.config();

describe("basic-test", async () => {
  const svm = new MagicSVM();

  // Get programId from target folder
  const keypairPath = "target/deploy/pinocchio_counter-keypair.json";
  const secretKeyArray = Uint8Array.from(
    JSON.parse(fs.readFileSync(keypairPath, "utf8")),
  );
  const keypair = Keypair.fromSecretKey(secretKeyArray);
  const PROGRAM_ID = keypair.publicKey;
  svm.addProgram(
    addressFromWeb3PublicKey(PROGRAM_ID),
    fs.readFileSync("target/deploy/pinocchio_counter.so"),
  );

  // Create user keypair and airdrop SOL if needed
  const userKeypair = Keypair.generate();
  const userSigner = signerFromWeb3Keypair(userKeypair);

  // Run this once before all tests
  beforeAll(async () => {
    svm.airdrop(userSigner.address, BigInt(2 * LAMPORTS_PER_SOL));
  });

  // Get pda of counter_account
  const [counterPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), userKeypair.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const bumpBytes = Buffer.from([bump]);
  console.log("Program ID: ", PROGRAM_ID.toString());
  console.log("Counter PDA: ", counterPda.toString());

  it("Initialize counter on Solana", async () => {
    // 1: InitializeCounter
    // Create, send and confirm transaction
    const tx = new Transaction();

    const keys = [
      // Initializer
      {
        pubkey: userKeypair.publicKey,
        isSigner: true,
        isWritable: true,
      },
      // Counter Account
      {
        pubkey: counterPda,
        isSigner: false,
        isWritable: true,
      },
      // System Program
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
    const initializeIx = new TransactionInstruction({
      keys: keys,
      programId: PROGRAM_ID,
      data: serializedInstructionData,
    });
    tx.add(initializeIx);

    const res = svm.sendTransaction(
      await transactionFromWeb3Transaction(tx, {
        payer: userSigner,
        recentBlockhash: svm.latestBlockhash(),
      }),
      {
        target: "base",
      },
    );
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`Initialize failed: ${res}`);
    }
  });

  it("Increase counter on Solana", async () => {
    // 1: IncreaseCounter
    // Create, send and confirm transaction
    const tx = new Transaction();
    const keys = [
      // Initializer
      {
        pubkey: userKeypair.publicKey,
        isSigner: true,
        isWritable: true,
      },
      // Counter Account
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
    const increaseCounterIx = new TransactionInstruction({
      keys: keys,
      programId: PROGRAM_ID,
      data: serializedInstructionData,
    });
    tx.add(increaseCounterIx);
    const res = svm.sendTransaction(
      await transactionFromWeb3Transaction(tx, {
        payer: userSigner,
        recentBlockhash: svm.latestBlockhash(),
      }),
      {
        target: "base",
      },
    );
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`Increase counter failed: ${res}`);
    }
  });

  it("Delegate counter to ER", async function () {
    const validatorPubkey = new PublicKey(svm.validatorIdentity().toString());
    const remainingAccounts = [
      { pubkey: validatorPubkey, isSigner: false, isWritable: false },
    ];

    // 2: Delegate
    // Create, send and confirm transaction
    const tx = new Transaction();
    const keys = [
      // Initializer
      {
        pubkey: userKeypair.publicKey,
        isSigner: true,
        isWritable: true,
      },
      // Counter Account
      {
        pubkey: counterPda,
        isSigner: false,
        isWritable: true,
      },
      // Owner Program
      {
        pubkey: PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      // Delegation Buffer
      {
        pubkey: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
          counterPda,
          PROGRAM_ID,
        ),
        isSigner: false,
        isWritable: true,
      },
      // Delegation Record
      {
        pubkey: delegationRecordPdaFromDelegatedAccount(counterPda),
        isSigner: false,
        isWritable: true,
      },
      // Delegation Metadata
      {
        pubkey: delegationMetadataPdaFromDelegatedAccount(counterPda),
        isSigner: false,
        isWritable: true,
      },
      // Delegation Program
      {
        pubkey: DELEGATION_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      // System Program
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
      // ER Validator
      ...remainingAccounts,
    ];
    const serializedInstructionData = Buffer.concat([
      Buffer.from(CounterInstruction.Delegate, "hex"),
      bumpBytes,
    ]);
    const delegateIx = new TransactionInstruction({
      keys: keys,
      programId: PROGRAM_ID,
      data: serializedInstructionData,
    });
    tx.add(delegateIx);
    const res = svm.sendTransaction(
      await transactionFromWeb3Transaction(tx, {
        payer: userSigner,
        recentBlockhash: svm.latestBlockhash(),
      }),
      {
        target: "base",
      },
    );
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`Delegate failed: ${res}`);
    }
  });

  it("Increase counter on ER (1)", async () => {
    // 1: IncreaseCounter
    // Create, send and confirm transaction
    const tx = new Transaction();
    const keys = [
      // Initializer
      {
        pubkey: userKeypair.publicKey,
        isSigner: true,
        isWritable: true,
      },
      // Counter Account
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
    const increaseCounterIx = new TransactionInstruction({
      keys: keys,
      programId: PROGRAM_ID,
      data: serializedInstructionData,
    });
    tx.add(increaseCounterIx);
    const res = svm.sendTransaction(
      await transactionFromWeb3Transaction(tx, {
        payer: userSigner,
        recentBlockhash: svm.latestBlockhashFor({ target: "ephemeral" }),
      }),
      {
        target: "ephemeral",
      },
    );
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`Increase counter failed: ${res}`);
    }
  });

  it("Commit counter state on ER to Solana", async () => {
    // 3: Commit
    // Create, send and confirm transaction
    const tx = new Transaction();
    const keys = [
      // Initializer
      {
        pubkey: userKeypair.publicKey,
        isSigner: true,
        isWritable: true,
      },
      // Counter Account
      {
        pubkey: counterPda,
        isSigner: false,
        isWritable: true,
      },
      // Magic Program
      {
        pubkey: MAGIC_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      // Magic Context
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
    const commitIx = new TransactionInstruction({
      keys: keys,
      programId: PROGRAM_ID,
      data: serializedInstructionData,
    });
    tx.add(commitIx);
    const res = svm.sendTransaction(
      await transactionFromWeb3Transaction(tx, {
        payer: signerFromWeb3Keypair(userKeypair),
        recentBlockhash: svm.latestBlockhash(),
      }),
      {
        target: "ephemeral",
      },
    );
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`Commit failed: ${res}`);
    }
  });

  it("Increase counter on ER (2)", async () => {
    // 1: IncreaseCounter
    // Create, send and confirm transaction
    const tx = new Transaction();
    const keys = [
      // Initializer
      {
        pubkey: userKeypair.publicKey,
        isSigner: true,
        isWritable: true,
      },
      // Counter Account
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
    const initializeIx = new TransactionInstruction({
      keys: keys,
      programId: PROGRAM_ID,
      data: serializedInstructionData,
    });
    tx.add(initializeIx);
    svm.expireBlockhashFor({ target: "ephemeral" });
    const res = svm.sendTransaction(
      await transactionFromWeb3Transaction(tx, {
        payer: userSigner,
        recentBlockhash: svm.latestBlockhashFor({ target: "ephemeral" }),
      }),
      {
        target: "ephemeral",
      },
    );
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`Increase counter failed: ${res}`);
    }
  });

  it("Commit and undelegate counter on ER to Solana", async function () {
    // 3: CommitAndUndelegate
    // Create, send and confirm transaction
    const tx = new Transaction();
    const keys = [
      // Initializer
      {
        pubkey: userKeypair.publicKey,
        isSigner: true,
        isWritable: true,
      },
      // Counter Account
      {
        pubkey: counterPda,
        isSigner: false,
        isWritable: true,
      },
      // Magic Program
      {
        pubkey: MAGIC_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      // Magic Context
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
    const undelegateIx = new TransactionInstruction({
      keys: keys,
      programId: PROGRAM_ID,
      data: serializedInstructionData,
    });
    tx.add(undelegateIx);
    const res = svm.sendTransaction(
      await transactionFromWeb3Transaction(tx, {
        payer: userSigner,
        recentBlockhash: svm.latestBlockhashFor({ target: "ephemeral" }),
      }),
      {
        target: "ephemeral",
      },
    );
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`Undelegate failed: ${res}`);
    }
  });
});
