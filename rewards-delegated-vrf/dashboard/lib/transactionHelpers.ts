/**
 * Transaction helper functions for reward distributor operations
 * All transactions skip preflight as required by the program
 */

import { PublicKey, Transaction } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { PDAs } from "./pda";

/**
 * Build an Initialize Reward Distributor transaction
 * Creates a new reward distributor with optional whitelist
 */
export async function buildInitializeDistributorTx(
  program: any,
  admin: PublicKey,
  whitelist: PublicKey[] = []
): Promise<Transaction> {
  const rewardDistributorPda = PDAs.getRewardDistributor(admin)[0];

  return await program.methods
    .initializeRewardDistributor(whitelist)
    .accounts({
      initializer: admin,
      rewardDistributor: rewardDistributorPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .transaction();
}

/**
 * Build a Set Whitelist transaction
 * Updates the whitelist of addresses allowed to access the distributor
 */
export async function buildSetWhitelistTx(
  program: any,
  admin: PublicKey,
  whitelist: PublicKey[]
): Promise<Transaction> {
  const rewardDistributorPda = PDAs.getRewardDistributor(admin)[0];

  return await program.methods
    .setWhitelist(whitelist)
    .accounts({
      admin,
      rewardDistributor: rewardDistributorPda,
    })
    .transaction();
}

/**
 * Build a Set Reward List transaction
 * Configures reward list parameters including ranges and timestamps
 */
export async function buildSetRewardListTx(
  program: any,
  admin: PublicKey,
  globalRangeMin: number,
  globalRangeMax: number,
  startTimestamp: number,
  endTimestamp: number
): Promise<Transaction> {
  const rewardDistributorPda = PDAs.getRewardDistributor(admin)[0];
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];

  return await program.methods
    .setRewardList(globalRangeMin, globalRangeMax, startTimestamp, endTimestamp)
    .accounts({
      admin,
      rewardDistributor: rewardDistributorPda,
      rewardList: rewardListPda,
    })
    .transaction();
}

/**
 * Build an Add Reward transaction
 * Adds a reward (SPL token or NFT) to the reward list
 * 
 * For new rewards, all parameters are required
 * For existing rewards, provide null for parameters not being updated
 */
export async function buildAddRewardTx(
  program: any,
  admin: PublicKey,
  rewardName: string,
  mint: PublicKey,
  tokenAccount: PublicKey,
  rewardAmount?: number | null,
  drawRangeMin?: number | null,
  drawRangeMax?: number | null,
  redemptionLimit?: number | null,
  metadata?: PublicKey
): Promise<Transaction> {
  const rewardDistributorPda = PDAs.getRewardDistributor(admin)[0];
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];

  const accounts: any = {
    admin,
    rewardDistributor: rewardDistributorPda,
    rewardList: rewardListPda,
    mint,
    tokenAccount,
  };

  if (metadata) {
    accounts.metadata = metadata;
  }

  return await program.methods
    .addReward(
      rewardName,
      rewardAmount ? new anchor.BN(rewardAmount) : null,
      drawRangeMin || null,
      drawRangeMax || null,
      redemptionLimit ? new anchor.BN(redemptionLimit) : null
    )
    .accounts(accounts)
    .transaction();
}

/**
 * Build a Remove Reward transaction
 * Removes a reward from the reward list
 */
export async function buildRemoveRewardTx(
  program: any,
  admin: PublicKey,
  rewardName: string
): Promise<Transaction> {
  const rewardDistributorPda = PDAs.getRewardDistributor(admin)[0];
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];

  return await program.methods
    .removeReward(rewardName)
    .accounts({
      admin,
      rewardDistributor: rewardDistributorPda,
      rewardList: rewardListPda,
    })
    .transaction();
}

/**
 * Build a Delegate Reward List transaction
 * Deploys the reward list to the Ephemeral Rollup
 */
export async function buildDelegateRewardListTx(
  program: any,
  admin: PublicKey
): Promise<Transaction> {
  const rewardDistributorPda = PDAs.getRewardDistributor(admin)[0];
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];

  return await program.methods
    .delegateRewardList()
    .accounts({
      admin,
      rewardDistributor: rewardDistributorPda,
      rewardList: rewardListPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .transaction();
}

/**
 * Build an Undelegate Reward List transaction
 * Withdraws the reward list from the Ephemeral Rollup
 */
export async function buildUndelegateRewardListTx(
  program: any,
  payer: PublicKey
): Promise<Transaction> {
  const rewardDistributorPda = PDAs.getRewardDistributor(payer)[0];
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];

  return await program.methods
    .undelegateRewardList()
    .accounts({
      payer,
      rewardDistributor: rewardDistributorPda,
      rewardList: rewardListPda,
    })
    .transaction();
}

/**
 * Build a Request Random Reward transaction
 * Initiates a VRF callback to distribute a random reward to a user
 */
export async function buildRequestRandomRewardTx(
  program: any,
  admin: PublicKey,
  user: PublicKey,
  clientSeed: number
): Promise<Transaction> {
  const rewardDistributorPda = PDAs.getRewardDistributor(admin)[0];
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];

  return await program.methods
    .requestRandomReward(clientSeed)
    .accounts({
      user,
      admin,
      rewardDistributor: rewardDistributorPda,
      rewardList: rewardListPda,
    })
    .transaction();
}

/**
 * Get metadata PDA for an NFT mint
 * Used when adding NFT rewards
 */
export function getMetadataPda(mint: PublicKey): PublicKey {
  const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METAPLEX_PROGRAM_ID
  );

  return pda;
}

/**
 * Get Master Edition PDA for an NFT mint
 * Used when creating NFT collections
 */
export function getMasterEditionPda(mint: PublicKey): PublicKey {
  const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METAPLEX_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    METAPLEX_PROGRAM_ID
  );

  return pda;
}
