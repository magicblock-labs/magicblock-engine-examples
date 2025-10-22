import {
  initializeSolSignerKeypair,
  airdropSolIfNeeded,
} from "./initializeKeypair";
import * as borsh from "borsh";
import * as fs from "fs";
import dotenv from "dotenv";
import {
  CounterInstruction,
  IncreaseCounterPayload,
} from "./schema";
import { 
  Connection, 
  DELEGATION_PROGRAM_ID,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID 
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
  setTransactionMessageFeePayer 
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system"
import { describe, it, beforeAll, expect } from "vitest";

dotenv.config();

describe("basic-test", async () => {
  const TEST_TIMEOUT = 60_000;

  console.log("🧪 Running rust-counter.ts test suite...");

  // Load the deployed program keypair and get Proram ID
  const keypairPath = "target/deploy/rust_counter-keypair.json";
  const secretKeyArray = Uint8Array.from(
    JSON.parse(fs.readFileSync(keypairPath, "utf8"))
  );
  const keypair = await createKeyPairFromBytes(secretKeyArray);
  const PROGRAM_ID = await getAddressFromPublicKey(keypair.publicKey)
  console.log("Program ID:", PROGRAM_ID);



  // Connections
  const connection = await Connection.create("https://devnet-router.magicblock.app", "wss://devnet-router.magicblock.app")
  const ephemeralConnection = await Connection.create("https://devnet-router.magicblock.app", "wss://devnet-router.magicblock.app")

  console.log("Base Layer RPC:", connection.clusterUrlHttp, "| Websocket:",  connection.clusterUrlWs);
  console.log("ER RPC:", ephemeralConnection.clusterUrlHttp, "| Websocket:", ephemeralConnection.clusterUrlWs);
  
  // Prepare user
  const userKeypair = await initializeSolSignerKeypair();
  const userPubkey = await getAddressFromPublicKey(userKeypair.publicKey)

  // Get PDA
  const addressEncoder = getAddressEncoder();
  const [counterPda, bump] = await getProgramDerivedAddress({
      programAddress: PROGRAM_ID,
      seeds: [
          Buffer.from("counter_account"),
          addressEncoder.encode(userPubkey)
      ],
  });
  console.log("Counter PDA:", counterPda);

  // Ensure test wallet has SOL
  beforeAll(async () => {
    await airdropSolIfNeeded(
      connection.clusterUrlHttp,
      connection.clusterUrlWs,
      userPubkey,
      2
    );
  }, TEST_TIMEOUT);

  it(
    "Initialize and delegate counter to ER",
    async () => {
      const start = Date.now();

      // Add local validator identity to the remaining accounts if running on localnet
      const remainingAccounts = connection.clusterUrlHttp.includes("localhost") || connection.clusterUrlHttp.includes("127.0.0.1")
          ? [
              {
                address: address("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
                role: AccountRole.READONLY
              },
          ]
      : [];

      // Prepare transaction
      const initAccounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER},
        { address: counterPda, role: AccountRole.WRITABLE  },
        { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      ];
      const serializedInitInstructionData = Buffer.from(
        CounterInstruction.InitializeCounter,
        "hex"
      );
      const initializeIx : Instruction = {
        accounts: initAccounts,
        programAddress: PROGRAM_ID,
        data: serializedInitInstructionData,
      };
      const delAccounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER},
        { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        { address: counterPda, role: AccountRole.WRITABLE  },
        { address: PROGRAM_ID, role: AccountRole.READONLY },
        {
          address: await delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
            counterPda,
            PROGRAM_ID
          ),
          role: AccountRole.WRITABLE
        },
        {
          address: await delegationRecordPdaFromDelegatedAccount(counterPda),
          role: AccountRole.WRITABLE
        },
        {
          address: await delegationMetadataPdaFromDelegatedAccount(counterPda),
          role: AccountRole.WRITABLE
        },
        { address: DELEGATION_PROGRAM_ID, role: AccountRole.READONLY },
        ...remainingAccounts,
      ];
      const serializedInstructionData = Buffer.from(
        CounterInstruction.Delegate,
        "hex"
      );
      const delegateIx : Instruction = {
        accounts: delAccounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayer(userPubkey, tx),
        tx => appendTransactionMessageInstructions([initializeIx], tx),
        tx => appendTransactionMessageInstructions([delegateIx], tx)
      );

      // Send and confirm transaction
      const txHash = await connection.sendAndConfirmTransaction(transactionMessage, [userKeypair],  { commitment: "confirmed", skipPreflight: true })

      console.log(`${Date.now() - start}ms (Base Layer) Delegate txHash: ${txHash}`);
      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT
  );
  it(
    "Increase delegated counter and commit through CPI",
    async () => {
      const start = Date.now();

      // Prepare transaction
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER},
        { address: counterPda, role: AccountRole.WRITABLE  },
        { address: address(MAGIC_PROGRAM_ID.toString()), role: AccountRole.READONLY},
        { address: address(MAGIC_CONTEXT_ID.toString()), role: AccountRole.WRITABLE}
      ];
      const serializedInstructionData = Buffer.concat([
          Buffer.from(CounterInstruction.IncrementAndCommit, 'hex'),
          borsh.serialize(IncreaseCounterPayload.schema, new IncreaseCounterPayload(1))
      ])
      const increaseAndCommitCounterIx : Instruction = {
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayer(userPubkey, tx),
        tx => appendTransactionMessageInstructions([increaseAndCommitCounterIx], tx)
      );

      // Send and confirm transaction
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(transactionMessage, [userKeypair],  { commitment: "confirmed", skipPreflight: true })


      const duration = Date.now() - start;
      console.log(`${duration}ms (ER) Increment and Commit txHash: ${txHash}`);

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT
  );
  it(
    "Increase delegated counter and undelegate through CPI",
    async () => {
      const start = Date.now();

      // Prepare transaction
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER},
        { address: counterPda, role: AccountRole.WRITABLE  },
        { address: address(MAGIC_PROGRAM_ID.toString()), role: AccountRole.READONLY},
        { address: address(MAGIC_CONTEXT_ID.toString()), role: AccountRole.WRITABLE}
      ];
      const serializedInstructionData = Buffer.concat([
          Buffer.from(CounterInstruction.IncrementAndUndelegate, 'hex'),
          borsh.serialize(IncreaseCounterPayload.schema, new IncreaseCounterPayload(1))
      ])
      const incrementAndUndelegateIx : Instruction = {
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayer(userPubkey, tx),
        tx => appendTransactionMessageInstructions([incrementAndUndelegateIx], tx)
      );

      // Send and confirm transaction
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(transactionMessage, [userKeypair],  { commitment: "confirmed", skipPreflight: true })

      const duration = Date.now() - start;
      console.log(`${duration}ms (ER) Increment and Undelegate txHash: ${txHash}`);

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT
  );
});

