import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Connection,
  sendAndConfirmTransaction,
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import {
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  createPhotonClient,
  COMPRESSED_DELEGATION_PROGRAM_ID,
  fetchDelegateCompressedDataBytes,
  fetchInitializeRecordData,
  convertPackedAddressTreeInfoToBytes,
  convertOutputStateTreeIndexToBytes,
  convertValidityProofToBytes,
  deriveCda,
  BATCHED_MERKLE_TREE,
} from "@magicblock-labs/ephemeral-rollups-sdk";

import { describe, it, expect } from "vitest";

import dotenv from "dotenv";
import { homedir } from "os";
dotenv.config();

const PROGRAM_ID = new PublicKey(
  "393Ryd4qXVSQPJe1XE1bkhgahmhyqqw2sKcojALKWgNp",
);

describe("pinocchio-compressed-counter", async () => {
  // Set up a connection to blockchain cluster
  const baseLayerUrl = process.env.RPC_URL || "http://localhost:7799";
  const baseLayerWsUrl = process.env.RPC_WS_URL || "ws://localhost:7800";
  console.log("Base Layer URL: ", baseLayerUrl);
  console.log("Base Layer WS URL: ", baseLayerWsUrl);
  const connectionBaseLayer = new Connection(baseLayerUrl, {
    wsEndpoint: baseLayerWsUrl,
  });
  const ephemeralRollupUrl =
    process.env.EPHEMERAL_URL || "http://localhost:8899";
  const ephemeralRollupWsUrl =
    process.env.EPHEMERAL_WS_URL || "ws://localhost:8900";
  console.log("Ephemeral Rollup URL: ", ephemeralRollupUrl);
  console.log("Ephemeral Rollup WS URL: ", ephemeralRollupWsUrl);
  const connectionEphemeralRollup = new Connection(ephemeralRollupUrl, {
    wsEndpoint: ephemeralRollupWsUrl,
  });
  console.log("Base Layer Connection: ", connectionBaseLayer.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    connectionEphemeralRollup.rpcEndpoint,
  );

  // Setup photon connection
  const photonUrl = process.env.PHOTON_URL || "http://localhost:8784";
  const proverUrl = process.env.PROVER_URL || "http://localhost:3001";
  console.log("Photon URL: ", photonUrl);
  console.log("Prover URL: ", proverUrl);
  const photonClient = createPhotonClient(baseLayerUrl, photonUrl, proverUrl);
  const addressTree = await photonClient.getAddressTreeInfoV2();

  // Create user keypair and airdrop SOL if needed
  const keypairBytes =
    process.env.KEYPAIR ||
    fs.readFileSync(homedir() + "/.config/solana/id.json", "utf8");
  const userKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(keypairBytes)),
  );

  const id = Keypair.generate().publicKey;

  // Get pda of counter_account
  const [counterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), id.toBuffer()],
    PROGRAM_ID,
  );
  console.log("Program ID: ", PROGRAM_ID.toString());
  console.log("Counter PDA: ", counterPda.toString());
  console.log(
    "Counter CDA: ",
    deriveCda(counterPda, addressTree.tree).toString(),
  );

  const validator = await fetch(ephemeralRollupUrl, {
    method: "POST",
    body: JSON.stringify({
      method: "getIdentity",
      jsonrpc: "2.0",
      id: "c1cae191-92ec-4606-880c-c7817afaa121",
      params: [{ commitment: "confirmed" }],
    }),
  })
    .then((res) => res.json())
    .then((data: any) => new PublicKey(data.result.identity));

  console.log("Validator: ", validator.toString());

  it("Initialize counter on Solana", async () => {
    const {
      validityProof,
      packedAddressTreeInfo,
      outputStateTreeIndex,
      remainingAccounts,
    } = await fetchInitializeRecordData(photonClient, counterPda);
    const validityProofBytes = convertValidityProofToBytes(validityProof);
    const packedAddressTreeInfoBytes = convertPackedAddressTreeInfoToBytes(
      packedAddressTreeInfo,
    );
    const outputStateTreeIndexBytes =
      convertOutputStateTreeIndexToBytes(outputStateTreeIndex);
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }))
      .add(
        new TransactionInstruction({
          keys: [
            { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: counterPda, isSigner: false, isWritable: true },
            {
              pubkey: COMPRESSED_DELEGATION_PROGRAM_ID,
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: SystemProgram.programId,
              isSigner: false,
              isWritable: false,
            },
            ...remainingAccounts,
          ],
          programId: PROGRAM_ID,
          data: Buffer.from([
            ...[0, 0, 0, 0, 0, 0, 0, 0],
            ...id.toBytes(),
            ...validityProofBytes,
            ...packedAddressTreeInfoBytes,
            ...outputStateTreeIndexBytes,
          ]),
        }),
      );

    const txHash = await sendAndConfirmTransaction(
      connectionBaseLayer,
      tx,
      [userKeypair],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    console.log(`(Base Layer) Initialize txHash: ${txHash}`);
    expect(txHash).toBeDefined();
  });

  it("Increase counter on Solana", async () => {
    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(1n);
    const tx = new Transaction().add(
      new TransactionInstruction({
        keys: [{ pubkey: counterPda, isSigner: false, isWritable: true }],
        programId: PROGRAM_ID,
        data: Buffer.from([...[1, 0, 0, 0, 0, 0, 0, 0], ...amount]),
      }),
    );

    const txHash = await sendAndConfirmTransaction(
      connectionBaseLayer,
      tx,
      [userKeypair],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    console.log(`(Base Layer) Increment txHash: ${txHash}`);
    expect(txHash).toBeDefined();
  });

  it("Delegate counter to ER", async function () {
    const { validityProofBytes, accountMetaBytes, remainingAccounts } =
      await fetchDelegateCompressedDataBytes(photonClient, counterPda);

    const tx = new Transaction().add(
      new TransactionInstruction({
        keys: [
          { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: counterPda, isSigner: false, isWritable: true },
          { pubkey: validator, isSigner: false, isWritable: false },
          {
            pubkey: COMPRESSED_DELEGATION_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          ...remainingAccounts,
        ],
        programId: PROGRAM_ID,
        data: Buffer.from([
          ...[2, 0, 0, 0, 0, 0, 0, 0],
          ...validityProofBytes,
          ...accountMetaBytes,
        ]),
      }),
    );

    const txHash = await sendAndConfirmTransaction(
      connectionBaseLayer,
      tx,
      [userKeypair],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    console.log(`(Base Layer) Delegate txHash: ${txHash}`);
    expect(txHash).toBeDefined();
  });

  it("Increase counter on ER", async () => {
    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(1n);
    const tx = new Transaction().add(
      new TransactionInstruction({
        keys: [{ pubkey: counterPda, isSigner: false, isWritable: true }],
        programId: PROGRAM_ID,
        data: Buffer.from([...[1, 0, 0, 0, 0, 0, 0, 0], ...amount]),
      }),
    );

    const txHash = await sendAndConfirmTransaction(
      connectionEphemeralRollup,
      tx,
      [userKeypair],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    console.log(`(ER) Increment txHash: ${txHash}`);
    expect(txHash).toBeDefined();
  });

  it("Undelegate counter on ER", async () => {
    const tx = new Transaction().add(
      new TransactionInstruction({
        keys: [
          { pubkey: userKeypair.publicKey, isSigner: true, isWritable: false },
          { pubkey: counterPda, isSigner: false, isWritable: true },
          { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
        ],
        programId: PROGRAM_ID,
        data: Buffer.from([...[3, 0, 0, 0, 0, 0, 0, 0]]),
      }),
    );

    const txHash = await sendAndConfirmTransaction(
      connectionEphemeralRollup,
      tx,
      [userKeypair],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    console.log(`(ER) Undelegate txHash: ${txHash}`);
    expect(txHash).toBeDefined();
  });
});
