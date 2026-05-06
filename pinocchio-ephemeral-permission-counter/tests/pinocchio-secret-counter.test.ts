import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Connection,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import {
  DELEGATION_PROGRAM_ID,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  getAuthToken,
  GetCommitmentSignature,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import * as nacl from "tweetnacl";
import path from "path";

import { describe, it, expect, beforeAll } from "vitest";

import dotenv from "dotenv";
import { homedir } from "os";
dotenv.config();

const VAULT = new PublicKey("MagicVau1t999999999999999999999999999999999");
const PROGRAM_ID = new PublicKey(
  "AAWCg4eJHpdmUtM8Wz6Thm8FDi6C3vnMksf1pt2vfxhf",
);

describe("pinocchio-ephemeral-secret-counter", async () => {
  // Open user keypair from private key or default location
  const KEYPAIR =
    process.env.PRIVATE_KEY ||
    fs.readFileSync(path.join(homedir(), "/.config/solana/id.json"), "utf8");
  const userKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(KEYPAIR)),
  );

  // Set up PER connection
  const teeUrl =
    process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
    "https://devnet-tee.magicblock.app";
  const teeWsUrl =
    process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-tee.magicblock.app";
  const authToken = teeUrl.includes("tee")
    ? (
        await getAuthToken(
          teeUrl,
          userKeypair.publicKey,
          (message: Uint8Array) =>
            Promise.resolve(nacl.sign.detached(message, userKeypair.secretKey)),
        )
      ).token
    : "";
  const teeUserUrl = authToken ? `${teeUrl}?token=${authToken}` : teeUrl;
  const teeUserWsUrl = authToken ? `${teeWsUrl}?token=${authToken}` : teeWsUrl;
  console.log(
    "User Explorer URL:",
    `https://explore.solana.com/?cluster=custom&customUrl=${teeUserUrl}`,
  );

  // Set up a connection to blockchain cluster
  const connectionBaseLayer = new Connection(
    process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com",
    { wsEndpoint: process.env.WS_ENDPOINT || "wss://api.devnet.solana.com" },
  );
  const connectionEphemeralRollup = new Connection(
    process.env.EPHEMERAL_PROVIDER_ENDPOINT || teeUserUrl,
    { wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || teeUserWsUrl },
  );
  console.log("Base Layer Connection: ", connectionBaseLayer.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    connectionEphemeralRollup.rpcEndpoint,
  );

  const id = Keypair.generate().publicKey;
  let validator: PublicKey = new PublicKey(
    "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
  );
  const unauthorizedKeypair = Keypair.generate();
  const unauthorizedAuthToken = teeUrl.includes("tee")
    ? await getAuthToken(
        teeUrl,
        unauthorizedKeypair.publicKey,
        (message: Uint8Array) =>
          Promise.resolve(
            nacl.sign.detached(message, unauthorizedKeypair.secretKey),
          ),
      )
    : "";
  const unauthorizedConnection = teeUrl.includes("tee")
    ? new Connection(
        `${process.env.EPHEMERAL_PROVIDER_ENDPOINT || teeUrl}?token=${unauthorizedAuthToken.token}`,
        {
          wsEndpoint: `${process.env.EPHEMERAL_WS_ENDPOINT || teeWsUrl}?token=${unauthorizedAuthToken.token}`,
        },
      )
    : new Connection(process.env.EPHEMERAL_PROVIDER_ENDPOINT || teeUrl, {
        wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || teeWsUrl,
      });
  console.log("Unauthorized Connection: ", unauthorizedConnection.rpcEndpoint);

  // Get pda of counter_account
  const [counterPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), id.toBuffer()],
    PROGRAM_ID,
  );
  console.log("Program ID: ", PROGRAM_ID.toString());
  console.log("Counter PDA: ", counterPda.toString());
  console.log("Bump: ", bump);

  // Get permission PDA
  const [permissionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("permission:"), counterPda.toBuffer()],
    PERMISSION_PROGRAM_ID,
  );
  console.log("Permission PDA: ", permissionPda.toString());

  beforeAll(async () => {
    const response = await fetch(teeUrl, {
      method: "POST",
      body: JSON.stringify({
        method: "getIdentity",
        jsonrpc: "2.0",
        id: "123456789",
      }),
    });
    const data: any = await response.json();
    console.log("Validator: ", data.result.identity);
    validator = new PublicKey(data.result.identity);
  });

  it("Initialize counter on Solana", async () => {
    const ixData = Buffer.concat([
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
      id.toBuffer(),
    ]);
    const tx = new Transaction().add(
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
    );

    const txHash = await sendAndConfirmTransaction(
      connectionBaseLayer,
      tx,
      [userKeypair],
      {
        commitment: "confirmed",
      },
    );
    console.log(`(Base Layer) Initialize txHash: ${txHash}`);
    expect(txHash).toBeDefined();

    let counter = await connectionBaseLayer.getAccountInfo(counterPda, {
      commitment: "confirmed",
    });
    expect(counter).toBeDefined();
    expect(counter?.data.subarray(32, 40)).toEqual(
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
    );
  });

  it("Increase counter on Solana", async () => {
    const ixData = Buffer.concat([
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
    ]);
    const tx = new Transaction().add(
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
    );

    const txHash = await sendAndConfirmTransaction(
      connectionBaseLayer,
      tx,
      [userKeypair],
      {
        commitment: "confirmed",
      },
    );
    console.log(`(Base Layer) Increment txHash: ${txHash}`);
    expect(txHash).toBeDefined();

    let counter = await connectionBaseLayer.getAccountInfo(counterPda, {
      commitment: "confirmed",
    });
    expect(counter).toBeDefined();
    expect(counter?.data.subarray(32, 40)).toEqual(
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
    );
  });

  it("Delegate counter to ER", async function () {
    const ixData = Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]);
    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        data: ixData,
        keys: [
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
          // PER Validator
          {
            pubkey: validator,
            isSigner: false,
            isWritable: false,
          },
        ],
      }),
    );

    const txHash = await sendAndConfirmTransaction(
      connectionBaseLayer,
      tx,
      [userKeypair],
      {
        commitment: "confirmed",
      },
    );
    console.log(`(Base Layer) Delegate txHash: ${txHash}`);
    expect(txHash).toBeDefined();
  });

  it("Increase counter on ER", async () => {
    const ixData = Buffer.concat([
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
    ]);
    const tx = new Transaction().add(
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
    );

    const txHash = await sendAndConfirmTransaction(
      connectionEphemeralRollup,
      tx,
      [userKeypair],
      {
        commitment: "confirmed",
      },
    );
    console.log(`(ER) Increment txHash: ${txHash}`);
    expect(txHash).toBeDefined();

    // Check readability
    let counter = await connectionEphemeralRollup.getAccountInfo(counterPda);
    expect(counter).toBeDefined();
    expect(counter?.data.subarray(32, 40)).toEqual(
      Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]),
    );

    counter = await unauthorizedConnection.getAccountInfo(counterPda);
    expect(counter).toBeDefined();
    expect(counter?.data.subarray(32, 40)).toEqual(
      Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]),
    );
  });

  it("Create permission on ER", async () => {
    const ixData = Buffer.from([4, 0, 0, 0, 0, 0, 0, 0]);
    const tx = new Transaction().add(
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
            pubkey: VAULT,
            isSigner: false,
            isWritable: true,
          },
        ],
      }),
    );

    const txHash = await sendAndConfirmTransaction(
      connectionEphemeralRollup,
      tx,
      [userKeypair],
      {
        commitment: "confirmed",
        skipPreflight: true,
      },
    );
    console.log(`(ER) Create permission txHash: ${txHash}`);
    expect(txHash).toBeDefined();

    // Check readability
    let counter = await connectionEphemeralRollup.getAccountInfo(counterPda);
    expect(counter).toBeDefined();
    expect(counter?.data.subarray(32, 40)).toEqual(
      Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]),
    );

    counter = await unauthorizedConnection.getAccountInfo(counterPda);
    if (teeUrl.includes("tee")) {
      expect(counter).toBeNull();
    } else {
      expect(counter).toBeDefined();
      expect(counter?.data.subarray(32, 40)).toEqual(
        Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]),
      );
    }

    // Check permission
    let permission =
      await connectionEphemeralRollup.getAccountInfo(permissionPda);
    expect(permission).toBeDefined();
    expect(permission?.data.subarray(36, 68)).toEqual(PROGRAM_ID.toBuffer());
    expect(permission?.data.subarray(69, 101)).toEqual(
      userKeypair.publicKey.toBuffer(),
    );
  });

  it("Close permission on ER", async () => {
    const ixData = Buffer.from([6, 0, 0, 0, 0, 0, 0, 0]);
    const tx = new Transaction().add(
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
            pubkey: VAULT,
            isSigner: false,
            isWritable: true,
          },
        ],
      }),
    );

    const txHash = await connectionEphemeralRollup.sendTransaction(
      tx,
      [userKeypair],
      { skipPreflight: true },
    );
    console.log(`(ER) Close permission txHash: ${txHash}`);
    const result = await connectionEphemeralRollup.confirmTransaction(txHash);
    expect(result.value?.err).toBeNull();
    expect(txHash).toBeDefined();

    // Check readability
    let counter = await connectionEphemeralRollup.getAccountInfo(counterPda);
    expect(counter).toBeDefined();
    expect(counter?.data.subarray(32, 40)).toEqual(
      Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]),
    );

    counter = await unauthorizedConnection.getAccountInfo(counterPda);
    expect(counter).toBeDefined();
    expect(counter?.data.subarray(32, 40)).toEqual(
      Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]),
    );
  });

  it.skip("Commit and undelegate counter on ER to Solana", async function () {
    const ixData = Buffer.from([3, 0, 0, 0, 0, 0, 0, 0]);
    const tx = new Transaction().add(
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
    );
    const txHash = await sendAndConfirmTransaction(
      connectionEphemeralRollup,
      tx,
      [userKeypair],
      {
        commitment: "confirmed",
      },
    );
    console.log(`(ER) Undelegate txHash: ${txHash}`);
    expect(txHash).toBeDefined();

    await GetCommitmentSignature(txHash, connectionEphemeralRollup);

    // Check readability
    let counter = await connectionBaseLayer.getAccountInfo(counterPda);
    expect(counter?.owner.equals(PROGRAM_ID)).toBe(true);
  });
});
