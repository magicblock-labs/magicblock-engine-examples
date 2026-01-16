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

  console.log("🧪 Running pinocchio-counter.ts test suite...");

  // Load the deployed program keypair and get Proram ID
  const keypairPath = "target/deploy/pinocchio_counter-keypair.json";
  const secretKeyArray = Uint8Array.from(
    JSON.parse(fs.readFileSync(keypairPath, "utf8"))
  );
  const keypair = await createKeyPairFromBytes(secretKeyArray);
  const PROGRAM_ID = await getAddressFromPublicKey(keypair.publicKey)

  // Connections
  const connection = await Connection.create(
    process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com",
    process.env.WS_ENDPOINT || "wss://api.devnet.solana.com"
  )
  const ephemeralConnection = await Connection.create(
    process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app",
    process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app"
  )

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
          Buffer.from("counter"),
          addressEncoder.encode(userPubkey)
      ],
  });
  console.log("Progam ID:", PROGRAM_ID);
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
    "Initialize counter on Solana",
    async () => {
      const start = Date.now();

      // Prepare transaction
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER},
        { address: counterPda, role: AccountRole.WRITABLE  },
        { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      ];
      const serializedInstructionData = Buffer.from(
        CounterInstruction.InitializeCounter,
        "hex"
      );
      const initializeIx : Instruction = {
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      let transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayer(userPubkey, tx),
        tx => appendTransactionMessageInstructions([initializeIx], tx)
      );

      // Send and confirm transaction
      const txHash = await connection.sendAndConfirmTransaction(transactionMessage, [userKeypair],  { commitment: "confirmed", skipPreflight: true })

      console.log(`${Date.now() - start}ms (Base Layer) Initialize txHash: ${txHash}`);

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT
  );

  it(
    "Increase counter on Solana",
    async () => {
      const start = Date.now();

      // Prepare transaction
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER},
        { address: counterPda, role: AccountRole.WRITABLE  },
      ];
      const serializedInstructionData = Buffer.concat([
        Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
        borsh.serialize(
          IncreaseCounterPayload.schema,
          new IncreaseCounterPayload(1)
        ),
      ]);
      const increaseCounterIx : Instruction = {
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayer(userPubkey, tx),
        tx => appendTransactionMessageInstructions([increaseCounterIx], tx)
      );

      // Send and confirm transaction
      const txHash = await connection.sendAndConfirmTransaction(transactionMessage, [userKeypair],  { commitment: "confirmed", skipPreflight: true })

      console.log(`${Date.now() - start}ms (Base Layer) Increment txHash: ${txHash}`);
      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT
  );

  it(
    "Delegate counter to ER",
    async () => {
      const start = Date.now();

      // Add local validator identity to the remaining accounts if running on localnet
      const remainingAccounts = connection.clusterUrlHttp.includes("localhost") || connection.clusterUrlHttp.includes("127.0.0.1")
        ? [
            {
              address: address("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
              role: AccountRole.READONLY
            }
        ]
        : [
            {
              address: address("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"),
              role: AccountRole.READONLY
            }
        ];

      // Prepare transaction
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER},
        { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        { address: counterPda, role: AccountRole.WRITABLE  },
        { address: PROGRAM_ID, role: AccountRole.READONLY },
        {
          address: await delegateBufferPdaFromDelegatedAccountAndOwnerProgram(counterPda, PROGRAM_ID),
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
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayer(userPubkey, tx),
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
    "Increase counter on ER",
    async () => {
      const start = Date.now();
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER},
        { address: counterPda, role: AccountRole.WRITABLE },
      ];
      const serializedInstructionData = Buffer.concat([
        Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
        borsh.serialize(
          IncreaseCounterPayload.schema,
          new IncreaseCounterPayload(1)
        ),
      ]);
      const increaseCounterIx : Instruction = {
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayer(userPubkey, tx),
        tx => appendTransactionMessageInstructions([increaseCounterIx], tx)
      );

      // Send and confirm transaction
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(transactionMessage, [userKeypair],  { commitment: "confirmed", skipPreflight: true })

      console.log(`${Date.now() - start}ms (ER) Increment txHash: ${txHash}`);
      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT
  );
  it(
    "Commit changes from ER back to Solana",
    async () => {
      const start = Date.now();

      // Prepare transaction
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER},
        { address: counterPda, role: AccountRole.WRITABLE  },
        { address: address(MAGIC_PROGRAM_ID.toString()), role: AccountRole.READONLY},
        { address: address(MAGIC_CONTEXT_ID.toString()), role: AccountRole.WRITABLE}
      ];
      const serializedInstructionData = Buffer.from(
        CounterInstruction.Commit,
        "hex"
      );
      const commitIx : Instruction = {
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayer(userPubkey, tx),
        tx => appendTransactionMessageInstructions([commitIx], tx)
      );

      // Send and confirm transaction
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(transactionMessage, [userKeypair],  { commitment: "confirmed", skipPreflight: true })


      const duration = Date.now() - start;
      console.log(`${duration}ms (ER) Commit txHash: ${txHash}`);

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT
  );
  it(
    "Increase counter on ER (2)",
    async () => {
      const start = Date.now();
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER},
        { address: counterPda, role: AccountRole.WRITABLE },
      ];
      const serializedInstructionData = Buffer.concat([
        Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
        borsh.serialize(
          IncreaseCounterPayload.schema,
          new IncreaseCounterPayload(1)
        ),
      ]);
      const increaseCounterIx : Instruction = {
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayer(userPubkey, tx),
        tx => appendTransactionMessageInstructions([increaseCounterIx], tx)
      );

      // Send and confirm transaction
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(transactionMessage, [userKeypair],  { commitment: "confirmed", skipPreflight: true })

      console.log(`${Date.now() - start}ms (ER) Increment txHash: ${txHash}`);

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT
  );
  it(
    "Undelegate counter from ER",
    async () => {
      const start = Date.now();

      // Prepare transaction
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER},
        { address: counterPda, role: AccountRole.WRITABLE  },
        { address: address(MAGIC_PROGRAM_ID.toString()), role: AccountRole.READONLY},
        { address: address(MAGIC_CONTEXT_ID.toString()), role: AccountRole.WRITABLE}
      ];
      const serializedInstructionData = Buffer.from(
        CounterInstruction.CommitAndUndelegate,
        "hex"
      );
      const undelegateIx : Instruction = {
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayer(userPubkey, tx),
        tx => appendTransactionMessageInstructions([undelegateIx], tx)
      );

      // Send and confirm transaction
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(transactionMessage, [userKeypair],  { commitment: "confirmed", skipPreflight: true })

      const duration = Date.now() - start;
      console.log(`${duration}ms (ER) Undelegate txHash: ${txHash}`);

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT
  );
});
