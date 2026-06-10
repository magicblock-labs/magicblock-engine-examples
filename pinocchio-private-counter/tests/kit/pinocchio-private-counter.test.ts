import { airdropSolIfNeeded } from "./initializeKeypair";
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

  // Prepare user: a freshly generated keypair every run. The counter PDA is
  // derived from this pubkey, so each run gets a clean, never-delegated account.
  // This avoids the stale split-delegation state a fixed wallet accumulates
  // (base still shows the PDA delegated, so the Init/Delegate guards skip, while
  // the ER copy is no longer delegated → every commit/undelegate then fails).
  // tweetnacl's 64-byte secretKey (seed‖pubkey) is the exact format
  // createKeyPairFromBytes wants and that nacl can sign the TEE auth challenge.
  const userSecretKey = nacl.sign.keyPair().secretKey;
  const userKeypair = await createKeyPairFromBytes(userSecretKey);
  const userPubkey = await getAddressFromPublicKey(userKeypair.publicKey);
  console.log("User Public Key:", userPubkey);

  // Set up PER connection (QFS/TEE requires auth token even on localhost)
  const teeUrl =
    process.env.TEE_PROVIDER_ENDPOINT || "https://tee.magicblock.app";
  const teeWsUrl = process.env.TEE_WS_ENDPOINT || "wss://tee.magicblock.app";
  const authToken = (
    await getAuthToken(teeUrl, userPubkey, (message: Uint8Array) =>
      Promise.resolve(nacl.sign.detached(message, userSecretKey)),
    )
  ).token;
  const teeUserUrl = `${teeUrl}?token=${authToken}`;
  const teeUserWsUrl = `${teeWsUrl}?token=${authToken}`;
  console.log(
    "User Explorer URL:",
    `https://solscan.io/?cluster=custom&customUrl=${teeUserUrl}`,
  );

  const connection = await Connection.create(
    process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com",
    process.env.WS_ENDPOINT || "wss://api.devnet.solana.com",
  );
  connection.isMagicRouter = false;
  const ephemeralConnection = await Connection.create(teeUserUrl, teeUserWsUrl);
  ephemeralConnection.isMagicRouter = false;

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
  const validator = address(
    process.env.VALIDATOR || "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
  );
  console.log("PER Validator: ", validator);

  // The local ER/QFS stack intermittently rejects the *first* send of an ER
  // transaction with "Transaction signature verification failure" — a transient
  // blockhash/routing hiccup (most often right after a commit, but also seen on
  // a writable-signer fee payer). It never lands on-chain, and because the kit
  // re-fetches the blockhash and re-signs on every call, an immediate re-send
  // clears it deterministically. Retry only on that specific send-time error so
  // genuine on-chain failures (which surface during confirmation with different
  // messages) are never masked.
  async function sendErAndConfirm(
    transactionMessage: Parameters<
      typeof ephemeralConnection.sendAndConfirmTransaction
    >[0],
    config: Parameters<
      typeof ephemeralConnection.sendAndConfirmTransaction
    >[2] = { skipPreflight: true },
    attempts = 4,
  ): Promise<string> {
    let lastErr: unknown;
    for (let i = 1; i <= attempts; i++) {
      try {
        return await ephemeralConnection.sendAndConfirmTransaction(
          transactionMessage,
          [userKeypair],
          config,
        );
      } catch (err: any) {
        lastErr = err;
        if (!String(err?.message ?? err).includes("signature verification")) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw lastErr;
  }

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
      const counterAccount = await connection.rpc
        .getAccountInfo(counterPda)
        .send();
      if (counterAccount.value?.owner == DELEGATION_PROGRAM_ID) {
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
      const counterAccount = await connection.rpc
        .getAccountInfo(counterPda)
        .send();
      if (counterAccount.value?.owner == DELEGATION_PROGRAM_ID) {
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
      const counterAccount = await connection.rpc
        .getAccountInfo(counterPda)
        .send();
      if (counterAccount.value?.owner == DELEGATION_PROGRAM_ID) {
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
        { address: validator, role: AccountRole.READONLY },
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

      const txHash = await sendErAndConfirm(transactionMessage, {
        commitment: "confirmed",
        skipPreflight: true,
      });

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
        { address: userPubkey, role: AccountRole.READONLY_SIGNER },
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

      const counterAccount = await ephemeralConnection.rpc
        .getAccountInfo(counterPda)
        .send();
      console.log(counterAccount);

      // Send and confirm transaction
      const txHash = await sendErAndConfirm(transactionMessage, {
        skipPreflight: true,
      });

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
        { address: userPubkey, role: AccountRole.READONLY_SIGNER },
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
      const txHash = await sendErAndConfirm(transactionMessage, {
        skipPreflight: true,
      });
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
        { address: userPubkey, role: AccountRole.READONLY_SIGNER },
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

      const counterAccount = await ephemeralConnection.rpc
        .getAccountInfo(counterPda)
        .send();
      console.log(counterAccount);

      // Send and confirm transaction
      const txHash = await sendErAndConfirm(transactionMessage, {
        skipPreflight: true,
      });

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
        { address: userPubkey, role: AccountRole.READONLY_SIGNER },
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

      const counterAccount = await ephemeralConnection.rpc
        .getAccountInfo(counterPda)
        .send();
      console.log(counterAccount);

      // Send and confirm transaction
      const txHash = await sendErAndConfirm(transactionMessage, {
        skipPreflight: true,
      });
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

      const counterAccount = await ephemeralConnection.rpc
        .getAccountInfo(counterPda)
        .send();
      console.log(counterAccount);

      // Send and confirm transaction
      const txHash = await sendErAndConfirm(transactionMessage, {
        skipPreflight: true,
      });

      const duration = Date.now() - start;
      console.log(`${duration}ms (PER) Undelegate txHash: ${txHash}`);

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT,
  );
});
