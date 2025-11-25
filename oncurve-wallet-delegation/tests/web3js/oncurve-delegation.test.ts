import {
  PublicKey,
  SystemProgram,
  Transaction,
  Connection,
  sendAndConfirmTransaction,
  Keypair
} from "@solana/web3.js";
import { initializeSolSignerKeypair, initializeFeePayer, airdropSolIfNeeded } from "./initializeKeypair";
import {
  createDelegateInstruction,
  createCommitInstruction,
  createCommitAndUndelegateInstruction,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";

import { describe, it, beforeAll, expect } from "vitest";

import dotenv from "dotenv";
dotenv.config();

describe("on-curve-delegation-web3js", async () => {
  const TEST_TIMEOUT = 60_000;
  console.log("🧪 Running on-curve-delegation web3js test suite...");

  // Set up connections
  const connectionBaseLayer = new Connection(
    process.env.PROVIDER_ENDPOINT || "https://rpc.magicblock.app/devnet",
    { wsEndpoint: process.env.WS_ENDPOINT || "wss://rpc.magicblock.app/devnet" }
  );
  const ephemeralConnection = new Connection(
    process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app",
    { wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app" }
  );
  console.log("Base Layer Connection: ", connectionBaseLayer.rpcEndpoint);
  console.log("Ephemeral Connection: ", ephemeralConnection.rpcEndpoint);

  // Create keypairs
  const userKeypair = initializeSolSignerKeypair();
  const userPubkey = userKeypair.publicKey;
  console.log("User:", userPubkey.toString());
  let feePayerKeypair: Keypair;
  let feePayerPubkey: PublicKey;

  // The owner program (typically system program for new accounts)
  const ownerProgram = SystemProgram.programId;
  console.log("Owner Program:", ownerProgram.toString());

  // The validator to delegate to
  const validator = new PublicKey(
    "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"
  );
  console.log("Validator:", validator.toString());

    // Run this once before all tests
  beforeAll(
    async () => {
      await airdropSolIfNeeded(
        connectionBaseLayer,
        userKeypair.publicKey,
        2,
        0.05
      );
      feePayerKeypair = await initializeFeePayer(connectionBaseLayer, userKeypair);
      feePayerPubkey = feePayerKeypair.publicKey;
      console.log("Fee Payer:", feePayerPubkey.toString());
    },
    TEST_TIMEOUT
  );

  it(
    "Assign owner + Delegate on-curve account",
    async () => {
      const start = Date.now();

      // Create assign instruction
      const assignInstruction = SystemProgram.assign({
        accountPubkey: userPubkey,
        programId: DELEGATION_PROGRAM_ID,
      });

      // Create delegate instruction
      const delegateInstruction = createDelegateInstruction(
        {
          payer: feePayerKeypair.publicKey,
          delegatedAccount: userPubkey,
          ownerProgram: ownerProgram,
          validator: validator
        }
      );

      // Create and send transaction (fee payer need to sign, on-curve account cannot be signer since delegated)
      const tx = new Transaction().add(assignInstruction, delegateInstruction);
      tx.feePayer = feePayerKeypair.publicKey;
      const txSignature = await sendAndConfirmTransaction(
        connectionBaseLayer,
        tx,
        [userKeypair, feePayerKeypair], {
          skipPreflight: true
        }
      );

      const duration = Date.now() - start;
      console.log(`${duration}ms - Delegate Signature: ${txSignature}`);
      expect(txSignature).toBeDefined();
    },
    TEST_TIMEOUT
  );

  it(
    "Commit on-curve account",
    async () => {
      const start = Date.now();

      const commitInstruction = createCommitInstruction(
        userPubkey,
        [userPubkey]
      );

      const tx = new Transaction().add(commitInstruction);
      tx.feePayer = feePayerKeypair.publicKey;
      const txSignature = await sendAndConfirmTransaction(
        ephemeralConnection,
        tx,
        [userKeypair, feePayerKeypair], {
          skipPreflight: true
        }
      );

      const duration = Date.now() - start;
      console.log(`${duration}ms - Commit Signature: ${txSignature}`);
      expect(txSignature).toBeDefined();
    },
    TEST_TIMEOUT
  );

  it(
    "Commit and undelegate on-curve account",
    async () => {
      const start = Date.now();

      // Create commit and undelegate instruction
      const commitAndUndelegateInstruction =
        createCommitAndUndelegateInstruction(userPubkey, [userPubkey]);

      const tx = new Transaction().add(commitAndUndelegateInstruction);
      tx.feePayer = feePayerKeypair.publicKey;

      // Send and confirm transaction on ephemeral connection
      const txSignature = await sendAndConfirmTransaction(
        ephemeralConnection,
        tx,
        [userKeypair, feePayerKeypair], {
          skipPreflight: true
        }
      );

      const duration = Date.now() - start;
      console.log(
        `${duration}ms - CommitAndUndelegate Signature: ${txSignature}`
      );
      expect(txSignature).toBeDefined();
    },
    TEST_TIMEOUT
  );
});
