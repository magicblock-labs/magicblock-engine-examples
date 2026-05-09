import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { PDAs } from "@/lib/pda";
import { PROGRAM_ID } from "@/lib/constants";
import { VRF_PROGRAM_ID, ORACLE_QUEUE, SLOT_HASHES_SYSVAR, getVrfProgramIdentity } from "@/lib/vrfConstants";
import { createReadonlyProvider, createProgram } from "@/lib/sendTransaction";
import type { VrfCallbackData } from "./types";

/**
 * Read the validator pubkey from a delegation record account.
 * DelegationRecord layout: [8 discriminator][32 authority = validator][...]
 */
async function getValidatorFromDelegationRecord(
  connection: Connection,
  delegationRecord: PublicKey
): Promise<PublicKey> {
  const accountInfo = await connection.getAccountInfo(delegationRecord);
  if (!accountInfo || accountInfo.data.length < 40) {
    throw new Error(`Delegation record not found or too short: ${delegationRecord.toBase58()}`);
  }
  return new PublicKey(accountInfo.data.slice(8, 40));
}

export async function buildRequestRandomReward(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey,
  user: PublicKey,
  clientSeed: number
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];
  const [transferLookupTablePda] = PDAs.getTransferLookupTable();
  const [delegationRecordRewardList] = PDAs.getDelegationRecord(rewardListPda);
  return program.methods
    .requestRandomReward(clientSeed)
    .accounts({
      user,
      admin: publicKey,
      rewardDistributor: rewardDistributorPda,
      rewardList: rewardListPda,
      transferLookupTable: transferLookupTablePda,
      oracleQueue: ORACLE_QUEUE,
      delegationRecordRewardList,
      programIdentity: getVrfProgramIdentity(),
      vrfProgram: VRF_PROGRAM_ID,
      slotHashes: SLOT_HASHES_SYSVAR,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .transaction();
}

/**
 * Subscribe to VRF callback logs on the given connection.
 * Must be called BEFORE sending the request transaction to avoid a race condition.
 * Returns a promise that resolves when the callback log arrives (or times out),
 * plus a cancel function to clean up early on send failure.
 */
export function listenForVrfCallback(
  connection: Connection,
  timeoutMs = 30_000
): { callbackPromise: Promise<VrfCallbackData | null>; cancel: () => void } {
  let listenerId: number | null = null;
  let done = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const callbackPromise = new Promise<VrfCallbackData | null>((resolve) => {
    timeoutId = setTimeout(() => {
      if (listenerId !== null) connection.removeOnLogsListener(listenerId);
      resolve(null);
    }, timeoutMs);

    try {
      listenerId = connection.onLogs(
        PROGRAM_ID,
        (logs) => {
          if (done) return;
          const relevantLogs = logs.logs.filter(
            (log) =>
              log.includes("Random result:") ||
              log.includes("Won reward") ||
              log.includes("exhausted") ||
              log.includes("Reward:")
          );
          if (relevantLogs.length > 0) {
            done = true;
            if (listenerId !== null) connection.removeOnLogsListener(listenerId);
            if (timeoutId) clearTimeout(timeoutId);
            resolve({
              signature: logs.signature,
              relevantLogs,
              txStatus: logs.err ? "failed" : "confirmed",
              error: logs.err ? JSON.stringify(logs.err) : undefined,
            });
          }
        },
        "confirmed"
      );
    } catch {
      if (timeoutId) clearTimeout(timeoutId);
      resolve(null);
    }
  });

  const cancel = () => {
    done = true;
    if (listenerId !== null) connection.removeOnLogsListener(listenerId);
    if (timeoutId) clearTimeout(timeoutId);
  };

  return { callbackPromise, cancel };
}

export async function buildAddReward(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey,
  rewardName: string,
  rewardMint: PublicKey,
  tokenAccount: PublicKey,
  rewardAmount?: number,
  drawRangeMin?: number,
  drawRangeMax?: number,
  redemptionLimit?: number,
  metadataAccount?: PublicKey
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];
  return program.methods
    .addReward(
      rewardName,
      rewardAmount ? new anchor.BN(rewardAmount) : null,
      drawRangeMin ?? null,
      drawRangeMax ?? null,
      redemptionLimit ? new anchor.BN(redemptionLimit) : null
    )
    .accounts({
      admin: publicKey,
      rewardDistributor: rewardDistributorPda,
      rewardList: rewardListPda,
      mint: rewardMint,
      tokenAccount,
      metadata: metadataAccount ?? null,
    } as any)
    .transaction();
}

export async function buildAddRewardsBatch(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey,
  rewards: Array<{
    rewardName: string;
    rewardMint: PublicKey;
    tokenAccount: PublicKey;
    rewardAmount?: number;
    drawRangeMin?: number;
    drawRangeMax?: number;
    redemptionLimit?: number;
    metadataAccount?: PublicKey;
  }>
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];
  const tx = new Transaction();
  for (const reward of rewards) {
    const ix = await program.methods
      .addReward(
        reward.rewardName,
        reward.rewardAmount ? new anchor.BN(reward.rewardAmount) : null,
        reward.drawRangeMin ?? null,
        reward.drawRangeMax ?? null,
        reward.redemptionLimit ? new anchor.BN(reward.redemptionLimit) : null
      )
      .accounts({
        admin: publicKey,
        rewardDistributor: rewardDistributorPda,
        rewardList: rewardListPda,
        mint: reward.rewardMint,
        tokenAccount: reward.tokenAccount,
        metadata: reward.metadataAccount ?? null,
      } as any)
      .instruction();
    tx.add(ix);
  }
  return tx;
}

export async function buildRemoveReward(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey,
  rewardName: string,
  rewardMint?: PublicKey,
  redemptionAmount?: number
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];
  const [transferLookupTablePda] = PDAs.getTransferLookupTable();
  const [delegationRecordRewardList] = PDAs.getDelegationRecord(rewardListPda);
  const validator = await getValidatorFromDelegationRecord(connection, delegationRecordRewardList);
  const [magicFeeVault] = PDAs.getMagicFeeVault(validator);
  return program.methods
    .removeReward(
      rewardName,
      rewardMint ?? null,
      redemptionAmount ? new anchor.BN(redemptionAmount) : null
    )
    .accounts({
      admin: publicKey,
      rewardDistributor: rewardDistributorPda,
      rewardList: rewardListPda,
      transferLookupTable: transferLookupTablePda,
      destination: publicKey,
      delegationRecordRewardList,
      magicFeeVault,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    } as any)
    .transaction();
}

export async function buildRemoveRewardsBatch(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey,
  items: Array<{
    rewardName: string;
    rewardMint?: PublicKey;
    redemptionAmount?: number;
  }>
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];
  const [transferLookupTablePda] = PDAs.getTransferLookupTable();
  const [delegationRecordRewardList] = PDAs.getDelegationRecord(rewardListPda);
  const validator = await getValidatorFromDelegationRecord(connection, delegationRecordRewardList);
  const [magicFeeVault] = PDAs.getMagicFeeVault(validator);
  const tx = new Transaction();
  for (const item of items) {
    const ix = await program.methods
      .removeReward(
        item.rewardName,
        item.rewardMint ?? null,
        item.redemptionAmount ? new anchor.BN(item.redemptionAmount) : null
      )
      .accounts({
        admin: publicKey,
        rewardDistributor: rewardDistributorPda,
        rewardList: rewardListPda,
        transferLookupTable: transferLookupTablePda,
        destination: publicKey,
        delegationRecordRewardList,
        magicFeeVault,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      } as any)
      .instruction();
    tx.add(ix);
  }
  return tx;
}

export async function buildUpdateReward(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey,
  currentRewardName: string,
  updatedRewardName: string | null,
  rewardMint: PublicKey | null,
  tokenAccount: PublicKey | null,
  rewardAmount: number | null,
  drawRangeMin: number | null,
  drawRangeMax: number | null
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];
  const accounts: any = {
    admin: publicKey,
    rewardDistributor: rewardDistributorPda,
    rewardList: rewardListPda,
    // Optional accounts must be explicitly null when not used.
    // Omitting them entirely causes Anchor to throw
    // "Account `mint` not provided" even though they are optional in the IDL.
    mint: rewardMint ?? null,
    tokenAccount: tokenAccount ?? null,
  };
  return program.methods
    .updateReward(
      currentRewardName,
      updatedRewardName,
      rewardAmount != null ? new anchor.BN(rewardAmount) : null,
      drawRangeMin,
      drawRangeMax
    )
    .accounts(accounts)
    .transaction();
}
