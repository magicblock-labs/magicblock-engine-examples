import {
  initializeSolSignerKeypair,
  initializeFeePayer,
  airdropSolIfNeeded,
  cryptoKeyPairToTransactionSigner,
} from "./initializeKeypair";
import dotenv from "dotenv";
import {
  Connection,
  createDelegateInstruction,
  createCommitInstruction,
  createCommitAndUndelegateInstruction,
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-kit";
import {
  address,
  createTransactionMessage,
  appendTransactionMessageInstructions,
  pipe,
  setTransactionMessageFeePayer,
  getAddressFromPublicKey,
  lamports,
} from "@solana/kit";
import { getAssignInstruction, getTransferSolInstruction } from "@solana-program/system";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { describe, it, beforeAll, expect } from "vitest";

dotenv.config();

describe("on-curve-delegation-kit", async () => {
  const TEST_TIMEOUT = 60_000;
  console.log("🧪 Running on-curve-delegation kit test suite...");

  // Connections
  const connection = await Connection.create(
    process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com",
    process.env.WS_ENDPOINT || "wss://api.devnet.solana.com"
  );
  const ephemeralConnection = await Connection.create(
    process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app",
    process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app"
  );

  console.log(
    "Base Layer RPC:",
    connection.clusterUrlHttp,
    "| Websocket:",
    connection.clusterUrlWs
  );
  console.log(
    "ER RPC:",
    ephemeralConnection.clusterUrlHttp,
    "| Websocket:",
    ephemeralConnection.clusterUrlWs
  );

  // Prepare keypairs
  const userKeypair = await initializeSolSignerKeypair();
  const userAddress = await getAddressFromPublicKey(userKeypair.publicKey);
  console.log(`User: ${userAddress}`)
  
  const feePayerKeypair = await initializeFeePayer(connection, userKeypair);
  const feePayerAddress = await getAddressFromPublicKey(feePayerKeypair.publicKey);
  console.log(`Fee Payer: ${feePayerAddress}`)

  // The owner program (typically system program)
  const ownerProgramAddress = SYSTEM_PROGRAM_ADDRESS;
  console.log("Owner Program:", ownerProgramAddress);

  // The validator to delegate to
  const validatorAddress = address("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
  console.log("Validator:", validatorAddress);

  // Ensure test wallets have SOL
  beforeAll(async () => {
    await airdropSolIfNeeded(
      connection.clusterUrlHttp,
      connection.clusterUrlWs,
      userAddress,
      2
    );
  }, TEST_TIMEOUT);

  it(
    "Assign owner + Delegate on-curve account",
    async () => {
      const start = Date.now();

      // Create assign instruction
      // The on-curve account must sign this instruction to change its owner
      const accountSigner = await cryptoKeyPairToTransactionSigner(userKeypair);
      const delegationProgramAddress = address(DELEGATION_PROGRAM_ID.toString());
      const assignInstruction = getAssignInstruction({
        account: accountSigner,
        programAddress: delegationProgramAddress,
      });

      // Create delegate instruction
      const delegateInstruction = await createDelegateInstruction(
        {
          payer: feePayerAddress,
          delegatedAccount: userAddress,
          ownerProgram: ownerProgramAddress,
          validator: validatorAddress
        }
      );

      // Prepare transaction
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayer(feePayerAddress, tx),
        (tx) =>
          appendTransactionMessageInstructions(
            [assignInstruction, delegateInstruction],
            tx
          )
      );

      // Send and confirm transaction (fee payer need to sign, on-curve account cannot be signer since delegated)
      const txHash = await connection.sendAndConfirmTransaction(
        transactionMessage,
        [userKeypair, feePayerKeypair],
        { commitment: "confirmed", skipPreflight: true }
      );

      const duration = Date.now() - start;
      console.log(`${duration}ms - Delegate Signature: ${txHash}`);

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT
  );

  it(
    "Commit on-curve account",
    async () => {
      const start = Date.now();

      // Create commit instruction
      const commitInstruction = createCommitInstruction(
        userAddress,
        [userAddress]
      );

      // Prepare transaction
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayer(feePayerAddress, tx),
        (tx) =>
          appendTransactionMessageInstructions([commitInstruction], tx)
      );

      // Send and confirm transaction on ephemeral connection
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(
        transactionMessage,
        [userKeypair, feePayerKeypair],
        { commitment: "confirmed", skipPreflight: true }
      );

      const duration = Date.now() - start;
      console.log(`${duration}ms - Commit Signature: ${txHash}`);

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT
  );

  it(
    "Commit and undelegate on-curve account",
    async () => {
      const start = Date.now();

      // Create commit and undelegate instruction
      const commitAndUndelegateInstruction =
        createCommitAndUndelegateInstruction(
          userAddress,
          [userAddress]
        );

      // Prepare transaction
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayer(feePayerAddress, tx),
        (tx) =>
          appendTransactionMessageInstructions(
            [commitAndUndelegateInstruction],
            tx
          )
      );

      // Send and confirm transaction on ephemeral connection
      const txHash = await ephemeralConnection.sendAndConfirmTransaction(
        transactionMessage,
        [userKeypair, feePayerKeypair],
        { commitment: "confirmed", skipPreflight: true }
      );

      const duration = Date.now() - start;
      console.log(`${duration}ms - CommitAndUndelegate Signature: ${txHash}`);

      expect(txHash).toBeDefined();
    },
    TEST_TIMEOUT
  );
});
