import {
  initializeSolSignerKeypair,
  airdropSolIfNeeded,
  loadSecretKeyBytes,
} from "./initializeKeypair";
import * as borsh from "borsh";
import * as fs from "fs";
import dotenv from "dotenv";
import { CounterInstruction, IncreaseCounterPayload } from "./schema";
import {
  Connection,
  DELEGATION_PROGRAM_ID,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  EPHEMERAL_VAULT_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  getAuthToken,
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
  setTransactionMessageFeePayer,
  createSolanaRpc,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import * as nacl from "tweetnacl";
import { describe, it, beforeAll, expect } from "vitest";

dotenv.config();

describe("basic-test", async () => {
  const TEST_TIMEOUT = 60_000;

  console.log("🧪 Running pinocchio-counter.ts test suite...");

  // Load the deployed program keypair and get Program ID
  const keypairPath = "target/deploy/pinocchio_private_counter-keypair.json";
  const secretKeyArray = Uint8Array.from(
    JSON.parse(fs.readFileSync(keypairPath, "utf8")),
  );
  const keypair = await createKeyPairFromBytes(secretKeyArray);
  const PROGRAM_ID = await getAddressFromPublicKey(keypair.publicKey);

  // Prepare user
  const userKeypair = await initializeSolSignerKeypair();
  const userPubkey = await getAddressFromPublicKey(userKeypair.publicKey);

  // Set up PER connection (QFS/TEE requires auth token even on localhost)
  const teeUrl =
    process.env.TEE_PROVIDER_ENDPOINT || "https://tee.magicblock.app";
  const teeWsUrl = process.env.TEE_WS_ENDPOINT || "wss://tee.magicblock.app";
  const authToken = (
    await getAuthToken(teeUrl, userPubkey, (message: Uint8Array) =>
      Promise.resolve(nacl.sign.detached(message, loadSecretKeyBytes())),
    )
  ).token;
  const teeUserUrl = `${teeUrl}?token=${authToken}`;
  const teeUserWsUrl = `${teeWsUrl}?token=${authToken}`;
  console.log(
    "User Explorer URL:",
    `https://solscan.io/?cluster=custom&customUrl=${teeUserUrl}`,
  );

  // Base layer uses kit; PER uses web3.js because kit signing is rejected by QFS/TEE.
  const rpc = createSolanaRpc(
    process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com",
  );
  const connection = await Connection.create(
    process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com",
    process.env.WS_ENDPOINT || "wss://api.devnet.solana.com",
  );
  const ephemeralConnection = await Connection.create(teeUserUrl, teeUserWsUrl);

  console.log(
    "Base Layer RPC:",
    connection.clusterUrlHttp,
    "| Websocket:",
    connection.clusterUrlWs,
  );
  console.log(
    "ER RPC:",
    ephemeralConnection.clusterUrlHttp,
    "| Websocket:",
    ephemeralConnection.clusterUrlWs,
  );

  // Get Counter PDA
  const addressEncoder = getAddressEncoder();
  const [counterPda, bump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [Buffer.from("counter"), addressEncoder.encode(userPubkey)],
  });
  // Get permission PDA
  const [permissionPda] = await getProgramDerivedAddress({
    programAddress: PERMISSION_PROGRAM_ID,
    seeds: [Buffer.from("permission:"), addressEncoder.encode(counterPda)],
  });
  console.log("Progam ID:", PROGRAM_ID);
  console.log("Counter PDA:", counterPda);
  console.log("Permision PDA:", permissionPda);

  // Add local validator identity to the remaining accounts if running on localnet
  const remainingAccounts =
    connection.clusterUrlHttp.includes("localhost") ||
    connection.clusterUrlHttp.includes("127.0.0.1") ||
    process.env.VALIDATOR
      ? [
          {
            address: address(
              process.env.VALIDATOR ||
                "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
            ),
            role: AccountRole.READONLY,
          },
        ]
      : [
          {
            address: address("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"),
            role: AccountRole.READONLY,
          },
        ];
  console.log("PER Validator: ", remainingAccounts[0].address);

  // Ensure test wallet has SOL
  beforeAll(async () => {
    await airdropSolIfNeeded(
      connection.clusterUrlHttp,
      connection.clusterUrlWs,
      userPubkey,
      2,
    );
  }, TEST_TIMEOUT);

  it(
    "Initialize counter on Solana",
    async () => {
      const counterAccount = await rpc.getAccountInfo(counterPda).send();
      if (counterAccount?.value.owner == DELEGATION_PROGRAM_ID) {
        console.log("Counter account already delegated");
        return;
      }

      const start = Date.now();

      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
        { address: counterPda, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      ];
      const serializedInstructionData = Buffer.concat([
        Buffer.from(CounterInstruction.InitializeCounter, "hex"),
        Buffer.from([bump]),
      ]);
      const initializeIx: Instruction = {
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayer(userPubkey, tx),
        (tx) => appendTransactionMessageInstructions([initializeIx], tx),
      );

      const txHash = await connection.sendAndConfirmTransaction(
        transactionMessage,
        [userKeypair],
        { commitment: "confirmed", skipPreflight: true },
      );

      console.log(
        `${Date.now() - start}ms (Base Layer) Initialize txHash: ${txHash}`,
      );

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT,
  );

  it(
    "Increase counter on Solana",
    async () => {
      const counterAccount = await rpc.getAccountInfo(counterPda).send();
      if (counterAccount?.value.owner == DELEGATION_PROGRAM_ID) {
        console.log("Counter account already delegated");
        return;
      }

      const start = Date.now();

      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
        { address: counterPda, role: AccountRole.WRITABLE },
      ];
      const serializedInstructionData = Buffer.concat([
        Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
        Buffer.from([bump]),
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
        (tx) => setTransactionMessageFeePayer(userPubkey, tx),
        (tx) => appendTransactionMessageInstructions([increaseCounterIx], tx),
      );

      const txHash = await connection.sendAndConfirmTransaction(
        transactionMessage,
        [userKeypair],
        { commitment: "confirmed", skipPreflight: true },
      );

      console.log(
        `${Date.now() - start}ms (Base Layer) Increment txHash: ${txHash}`,
      );
      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT,
  );

  it(
    "Delegate counter to PER",
    async () => {
      const counterAccount = await rpc.getAccountInfo(counterPda).send();
      if (counterAccount?.value.owner == DELEGATION_PROGRAM_ID) {
        console.log("Counter account already delegated");
        return;
      }

      const start = Date.now();

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
        { address: permissionPda, role: AccountRole.READONLY },
        { address: PERMISSION_PROGRAM_ID, role: AccountRole.READONLY },
      ];
      const serializedInstructionData = Buffer.concat([
        Buffer.from(CounterInstruction.Delegate, "hex"),
        Buffer.from([bump]),
      ]);
      const delegateIx: Instruction = {
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayer(userPubkey, tx),
        (tx) => appendTransactionMessageInstructions([delegateIx], tx),
      );

      const txHash = await connection.sendAndConfirmTransaction(
        transactionMessage,
        [userKeypair],
        { commitment: "confirmed", skipPreflight: true },
      );

      console.log(
        `${Date.now() - start}ms (Base Layer) Delegate txHash: ${txHash}`,
      );
      expect(txHash).toBeDefined();

      // Wait for delegation to propagate to the PER
      await new Promise((resolve) => setTimeout(resolve, 3000));
    },
    TEST_TIMEOUT,
  );

  it(
    "Initialize ephemeral permission on PER",
    async () => {
      const start = Date.now();
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
        { address: counterPda, role: AccountRole.WRITABLE },
        { address: permissionPda, role: AccountRole.WRITABLE },
        { address: EPHEMERAL_VAULT_ID, role: AccountRole.WRITABLE },
        { address: MAGIC_PROGRAM_ID, role: AccountRole.READONLY },
        { address: PERMISSION_PROGRAM_ID, role: AccountRole.READONLY },
      ];
      const serializedInstructionData = Buffer.concat([
        Buffer.from(CounterInstruction.InitPermission, "hex"),
        Buffer.from([bump]),
      ]);
      const initPermissionIx: Instruction = {
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayer(userPubkey, tx),
        (tx) => appendTransactionMessageInstructions([initPermissionIx], tx),
      );

      const txHash = await ephemeralConnection.sendAndConfirmTransaction(
        transactionMessage,
        [userKeypair],
        { commitment: "confirmed", skipPreflight: true },
      );

      console.log(
        `${Date.now() - start}ms (PER) Init permission txHash: ${txHash}`,
      );
      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT,
  );

  it(
    "Increase counter on PER",
    async () => {
      const start = Date.now();
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
        { address: counterPda, role: AccountRole.WRITABLE },
      ];
      const serializedInstructionData = Buffer.concat([
        Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
        Buffer.from([bump]),
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
        (tx) => setTransactionMessageFeePayer(userPubkey, tx),
        (tx) => appendTransactionMessageInstructions([increaseCounterIx], tx),
      );

      // Send and confirm transaction
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(
        transactionMessage,
        [userKeypair],
        { skipPreflight: true },
      );

      console.log(`${Date.now() - start}ms (PER) Increment txHash: ${txHash}`);
      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT,
  );

  it(
    "Closes ephemeral permission on PER",
    async () => {
      const start = Date.now();
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
        { address: counterPda, role: AccountRole.WRITABLE },
        { address: permissionPda, role: AccountRole.WRITABLE },
        { address: EPHEMERAL_VAULT_ID, role: AccountRole.WRITABLE },
        { address: MAGIC_PROGRAM_ID, role: AccountRole.READONLY },
        { address: PERMISSION_PROGRAM_ID, role: AccountRole.READONLY },
      ];
      const serializedInstructionData = Buffer.concat([
        Buffer.from(CounterInstruction.ClosePermission, "hex"),
        Buffer.from([bump]),
      ]);
      const closePermissionIx: Instruction = {
        accounts,
        programAddress: PROGRAM_ID,
        data: serializedInstructionData,
      };
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayer(userPubkey, tx),
        (tx) => appendTransactionMessageInstructions([closePermissionIx], tx),
      );
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(
        transactionMessage,
        [userKeypair],
        { skipPreflight: true },
      );
      console.log(
        `${Date.now() - start}ms (PER) Close permission txHash: ${txHash}`,
      );
      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT,
  );

  it(
    "Commit changes from PER back to Solana",
    async () => {
      const start = Date.now();

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
        (tx) => setTransactionMessageFeePayer(userPubkey, tx),
        (tx) => appendTransactionMessageInstructions([commitIx], tx),
      );

      // Send and confirm transaction
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(
        transactionMessage,
        [userKeypair],
        { skipPreflight: true },
      );

      const duration = Date.now() - start;
      console.log(`${duration}ms (PER) Commit txHash: ${txHash}`);

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT,
  );

  it(
    "Increase counter on PER (2)",
    async () => {
      const start = Date.now();
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
        { address: counterPda, role: AccountRole.WRITABLE },
      ];
      const serializedInstructionData = Buffer.concat([
        Buffer.from(CounterInstruction.IncreaseCounter, "hex"),
        Buffer.from([bump]),
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
        (tx) => setTransactionMessageFeePayer(userPubkey, tx),
        (tx) => appendTransactionMessageInstructions([increaseCounterIx], tx),
      );

      // Send and confirm transaction
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(
        transactionMessage,
        [userKeypair],
        { skipPreflight: true },
      );
      console.log(`${Date.now() - start}ms (PER) Increment txHash: ${txHash}`);
      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT,
  );

  it(
    "Undelegate counter from PER",
    async () => {
      const start = Date.now();

      // Prepare transaction
      const accounts = [
        { address: userPubkey, role: AccountRole.WRITABLE_SIGNER },
        { address: counterPda, role: AccountRole.WRITABLE },
        { address: MAGIC_PROGRAM_ID, role: AccountRole.READONLY },
        { address: MAGIC_CONTEXT_ID, role: AccountRole.WRITABLE },
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
        (tx) => setTransactionMessageFeePayer(userPubkey, tx),
        (tx) => appendTransactionMessageInstructions([undelegateIx], tx),
      );

      // Send and confirm transaction
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(
        transactionMessage,
        [userKeypair],
        { skipPreflight: true },
      );

      const duration = Date.now() - start;
      console.log(`${duration}ms (PER) Undelegate txHash: ${txHash}`);

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT,
  );
});
