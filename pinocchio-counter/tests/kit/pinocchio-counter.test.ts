import * as borsh from "borsh";
import * as fs from "fs";
import dotenv from "dotenv";
import { CounterInstruction, IncreaseCounterPayload } from "./schema";
import {
  DELEGATION_PROGRAM_ID,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-kit";
import {
  Instruction,
  getAddressEncoder,
  getProgramDerivedAddress,
  AccountRole,
  createKeyPairFromBytes,
  getAddressFromPublicKey,
  address,
  createTransactionMessage,
  appendTransactionMessageInstructions,
  pipe,
  createKeyPairSignerFromPrivateKeyBytes,
  Address,
  KeyPairSigner,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { describe, it, beforeAll } from "vitest";
import { FailedTransactionMetadata, MagicSVM } from "@magicblock-labs/magicsvm";
import { transactionFromKitTransactionMessage } from "test-utils";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

dotenv.config();

describe("basic-test", () => {
  const svm = new MagicSVM();

  // Load the deployed program keypair and get Proram ID
  const keypairPath = "target/deploy/pinocchio_counter-keypair.json";
  const secretKeyArray = Uint8Array.from(
    JSON.parse(fs.readFileSync(keypairPath, "utf8")),
  );
  let keypair;
  let PROGRAM_ID: Address;

  // Prepare user
  let userSigner: KeyPairSigner;
  let userPubkey: Address;

  // Get PDA
  const addressEncoder = getAddressEncoder();
  let counterPda: Address;
  let bump: number;
  let bumpBytes: Buffer;

  // Ensure test wallet has SOL
  beforeAll(async () => {
    keypair = await createKeyPairFromBytes(secretKeyArray);
    PROGRAM_ID = await getAddressFromPublicKey(keypair.publicKey);
    svm.addProgram(
      PROGRAM_ID,
      fs.readFileSync("target/deploy/pinocchio_counter.so"),
    );

    userSigner = await createKeyPairSignerFromPrivateKeyBytes(
      Uint8Array.from(
        new Array(32).fill(0).map((_) => Math.floor(Math.random() * 256)),
      ),
    );
    userPubkey = userSigner.address;

    [counterPda, bump] = await getProgramDerivedAddress({
      programAddress: PROGRAM_ID,
      seeds: [Buffer.from("counter"), addressEncoder.encode(userPubkey)],
    });
    bumpBytes = Buffer.from([bump]);

    console.log("Progam ID:", PROGRAM_ID);
    console.log("Counter PDA:", counterPda);

    svm.airdrop(userPubkey, BigInt(2 * LAMPORTS_PER_SOL));
  });

  it("Initialize counter on Solana", async () => {
    // Prepare transaction
    const accounts = [
      { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
      { address: counterPda, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ];
    const serializedInstructionData = Buffer.concat([
      Buffer.from(CounterInstruction.InitializeCounter, "hex"),
      bumpBytes,
    ]);
    const initializeIx: Instruction = {
      accounts,
      programAddress: PROGRAM_ID,
      data: serializedInstructionData,
    };
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => appendTransactionMessageInstructions([initializeIx], tx),
    );

    // Send and confirm transaction
    const res = svm.sendTransaction(
      await transactionFromKitTransactionMessage(transactionMessage, {
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
    // Prepare transaction
    const accounts = [
      { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
      { address: counterPda, role: AccountRole.WRITABLE },
    ];
    const serializedInstructionData = Buffer.concat([
      Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
      bumpBytes,
      borsh.serialize(
        IncreaseCounterPayload.schema,
        new IncreaseCounterPayload(1),
      ),
    ]);
    const increaseCounterIx: Instruction = {
      accounts,
      programAddress: PROGRAM_ID,
      data: serializedInstructionData,
    };
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => appendTransactionMessageInstructions([increaseCounterIx], tx),
    );

    // Send and confirm transaction
    const res = svm.sendTransaction(
      await transactionFromKitTransactionMessage(transactionMessage, {
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

  it("Delegate counter to ER", async () => {
    const validatorAddress = address(svm.validatorIdentity().toString());
    const remainingAccounts = [
      { address: validatorAddress, role: AccountRole.READONLY },
    ];

    // Prepare transaction
    const accounts = [
      { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
      { address: counterPda, role: AccountRole.WRITABLE },
      { address: PROGRAM_ID, role: AccountRole.READONLY },
      {
        address: await delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
          counterPda,
          PROGRAM_ID,
        ),
        role: AccountRole.WRITABLE,
      },
      {
        address: await delegationRecordPdaFromDelegatedAccount(counterPda),
        role: AccountRole.WRITABLE,
      },
      {
        address: await delegationMetadataPdaFromDelegatedAccount(counterPda),
        role: AccountRole.WRITABLE,
      },
      { address: DELEGATION_PROGRAM_ID, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      ...remainingAccounts,
    ];
    const serializedInstructionData = Buffer.concat([
      Buffer.from(CounterInstruction.Delegate, "hex"),
      bumpBytes,
    ]);
    const delegateIx: Instruction = {
      accounts,
      programAddress: PROGRAM_ID,
      data: serializedInstructionData,
    };
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => appendTransactionMessageInstructions([delegateIx], tx),
    );

    // Send and confirm transaction
    const res = svm.sendTransaction(
      await transactionFromKitTransactionMessage(transactionMessage, {
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

  it("Increase counter on ER", async () => {
    const accounts = [
      { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
      { address: counterPda, role: AccountRole.WRITABLE },
    ];
    const serializedInstructionData = Buffer.concat([
      Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
      bumpBytes,
      borsh.serialize(
        IncreaseCounterPayload.schema,
        new IncreaseCounterPayload(1),
      ),
    ]);
    const increaseCounterIx: Instruction = {
      accounts,
      programAddress: PROGRAM_ID,
      data: serializedInstructionData,
    };
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => appendTransactionMessageInstructions([increaseCounterIx], tx),
    );

    // Send and confirm transaction
    const res = svm.sendTransaction(
      await transactionFromKitTransactionMessage(transactionMessage, {
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

  it("Commit changes from ER back to Solana", async () => {
    // Prepare transaction
    const accounts = [
      { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
      { address: counterPda, role: AccountRole.WRITABLE },
      {
        address: address(MAGIC_PROGRAM_ID.toString()),
        role: AccountRole.READONLY,
      },
      {
        address: address(MAGIC_CONTEXT_ID.toString()),
        role: AccountRole.WRITABLE,
      },
    ];
    const serializedInstructionData = Buffer.from(
      CounterInstruction.Commit,
      "hex",
    );
    const commitIx: Instruction = {
      accounts,
      programAddress: PROGRAM_ID,
      data: serializedInstructionData,
    };
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => appendTransactionMessageInstructions([commitIx], tx),
    );

    // Send and confirm transaction
    const res = svm.sendTransaction(
      await transactionFromKitTransactionMessage(transactionMessage, {
        payer: userSigner,
        recentBlockhash: svm.latestBlockhashFor({ target: "ephemeral" }),
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
    const accounts = [
      { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
      { address: counterPda, role: AccountRole.WRITABLE },
    ];
    const serializedInstructionData = Buffer.concat([
      Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
      bumpBytes,
      borsh.serialize(
        IncreaseCounterPayload.schema,
        new IncreaseCounterPayload(1),
      ),
    ]);
    const increaseCounterIx: Instruction = {
      accounts,
      programAddress: PROGRAM_ID,
      data: serializedInstructionData,
    };
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => appendTransactionMessageInstructions([increaseCounterIx], tx),
    );

    // Send and confirm transaction
    svm.expireBlockhashFor({ target: "ephemeral" });
    const res = svm.sendTransaction(
      await transactionFromKitTransactionMessage(transactionMessage, {
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

  it("Undelegate counter from ER", async () => {
    // Prepare transaction
    const accounts = [
      { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
      { address: counterPda, role: AccountRole.WRITABLE },
      {
        address: address(MAGIC_PROGRAM_ID.toString()),
        role: AccountRole.READONLY,
      },
      {
        address: address(MAGIC_CONTEXT_ID.toString()),
        role: AccountRole.WRITABLE,
      },
    ];
    const serializedInstructionData = Buffer.from(
      CounterInstruction.CommitAndUndelegate,
      "hex",
    );
    const undelegateIx: Instruction = {
      accounts,
      programAddress: PROGRAM_ID,
      data: serializedInstructionData,
    };
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => appendTransactionMessageInstructions([undelegateIx], tx),
    );

    // Send and confirm transaction
    const res = svm.sendTransaction(
      await transactionFromKitTransactionMessage(transactionMessage, {
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
