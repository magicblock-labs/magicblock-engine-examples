/**
 * API Module for common dashboard operations
 * This module provides helper functions for interacting with the program
 */

import { PublicKey, Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PDAs } from "./pda";
import { ProgramClient } from "./program";

/**
 * Fetch all data for a specific wallet (distributor owner)
 */
export async function fetchWalletRewardData(wallet: PublicKey) {
  const client = new ProgramClient();
  const [distributorPda] = PDAs.getRewardDistributor(wallet);
  const [rewardListPda] = PDAs.getRewardList(distributorPda);
  const [lookupTablePda] = PDAs.getTransferLookupTable();

  const [distributor, rewardList, lookupTable] = await Promise.all([
    client.fetchRewardDistributor(distributorPda),
    client.fetchRewardsList(rewardListPda),
    client.fetchTransferLookupTable(lookupTablePda),
  ]);

  return {
    wallet,
    distributorPda,
    rewardListPda,
    distributor,
    rewardList,
    lookupTable,
  };
}

/**
 * Get token account balance for a mint
 */
export async function getTokenBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<number> {
  try {
    const tokenAccount = getAssociatedTokenAddressSync(mint, owner, true);
    const balance = await connection.getTokenAccountBalance(tokenAccount);
    return balance.value.uiAmount || 0;
  } catch (error) {
    console.error("Error fetching token balance:", error);
    return 0;
  }
}

/**
 * Get all NFT mints for a distributor
 */
export function getAllRewardMints(rewardListPda: any): PublicKey[] {
  if (!rewardListPda || !rewardListPda.rewards) return [];

  const mints = new Set<string>();
  for (const reward of rewardListPda.rewards) {
    for (const mint of reward.rewardMints) {
      mints.add(mint.toString());
    }
  }

  return Array.from(mints).map((m) => new PublicKey(m));
}

/**
 * Get reward statistics
 */
export function getRewardStats(rewardListPda: any) {
  if (!rewardListPda || !rewardListPda.rewards) {
    return {
      totalRewards: 0,
      totalRedeemed: 0n,
      totalCapacity: 0n,
      utilizationPercent: 0,
    };
  }

  let totalRedeemed = 0n;
  let totalCapacity = 0n;

  for (const reward of rewardListPda.rewards) {
    totalRedeemed += reward.redemptionCount;
    totalCapacity += reward.redemptionLimit;
  }

  const utilizationPercent =
    totalCapacity > 0n ? (Number(totalRedeemed) / Number(totalCapacity)) * 100 : 0;

  return {
    totalRewards: rewardListPda.rewards.length,
    totalRedeemed,
    totalCapacity,
    utilizationPercent: Math.round(utilizationPercent),
  };
}

/**
 * Check if a user is admin of distributor
 */
export function isAdmin(
  userAddress: PublicKey,
  distributor: any
): boolean {
  if (!distributor) return false;
  if (distributor.superAdmin.equals(userAddress)) return true;
  return distributor.admins.some((admin: PublicKey) =>
    admin.equals(userAddress)
  );
}

/**
 * Check if a user is whitelisted
 */
export function isWhitelisted(
  userAddress: PublicKey,
  distributor: any
): boolean {
  if (!distributor || !distributor.whitelist) return false;
  return distributor.whitelist.some((item: PublicKey) =>
    item.equals(userAddress)
  );
}

/**
 * Get active rewards (within time window)
 */
export function getActiveRewards(rewardListPda: any): any[] {
  if (!rewardListPda || !rewardListPda.rewards) return [];

  const now = Math.floor(Date.now() / 1000);
  const isActive =
    now >= Number(rewardListPda.startTimestamp) &&
    now <= Number(rewardListPda.endTimestamp);

  return isActive ? rewardListPda.rewards : [];
}

/**
 * Get available rewards (not yet exhausted)
 */
export function getAvailableRewards(rewardListPda: any): any[] {
  if (!rewardListPda || !rewardListPda.rewards) return [];

  return rewardListPda.rewards.filter(
    (reward: any) =>
      BigInt(reward.redemptionCount) < BigInt(reward.redemptionLimit)
  );
}

/**
 * Search for rewards by name
 */
export function searchRewards(
  rewardListPda: any,
  query: string
): any[] {
  if (!rewardListPda || !rewardListPda.rewards) return [];

  const lowerQuery = query.toLowerCase();
  return rewardListPda.rewards.filter((reward: any) =>
    reward.name.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get reward by name
 */
export function getRewardByName(rewardListPda: any, name: string): any | null {
  if (!rewardListPda || !rewardListPda.rewards) return null;

  return (
    rewardListPda.rewards.find(
      (reward: any) => reward.name.toLowerCase() === name.toLowerCase()
    ) || null
  );
}

/**
 * Filter rewards by type
 */
export function filterRewardsByType(
  rewardListPda: any,
  rewardTypeName: string
): any[] {
  if (!rewardListPda || !rewardListPda.rewards) return [];

  const searchTerm = rewardTypeName.toLowerCase();
  
  return rewardListPda.rewards.filter((reward: any) => {
    const typeName = Object.keys(reward.rewardType)[0]?.toLowerCase() || "";
    return typeName.includes(searchTerm);
  });
}

/**
 * Calculate total asset value (simplified - would need token prices for full calculation)
 */
export function calculateTotalAssets(rewardListPda: any): bigint {
  if (!rewardListPda || !rewardListPda.rewards) return 0n;

  let total = 0n;
  for (const reward of rewardListPda.rewards) {
    const mintsCount = BigInt(reward.rewardMints.length || 1);
    const amount = BigInt(reward.rewardAmount || 0);
    const limit = BigInt(reward.redemptionLimit || 0);

    // Simplified: amount * limit (actual value would need token decimals and prices)
    total += amount * limit * mintsCount;
  }

  return total;
}

/**
 * Export rewards data as CSV
 */
export function exportRewardsToCSV(rewardListPda: any): string {
  if (!rewardListPda || !rewardListPda.rewards) return "";

  const headers = [
    "Name",
    "Type",
    "Draw Range Min",
    "Draw Range Max",
    "Amount",
    "Redeemed",
    "Limit",
    "Mints",
  ];

  const rows = rewardListPda.rewards.map((reward: any) => [
    reward.name,
    Object.keys(reward.rewardType)[0],
    reward.drawRangeMin,
    reward.drawRangeMax,
    reward.rewardAmount.toString(),
    reward.redemptionCount.toString(),
    reward.redemptionLimit.toString(),
    reward.rewardMints.map((m: PublicKey) => m.toString()).join(";"),
  ]);

  const csv = [
    headers.join(","),
    ...rows.map((row: any[]) => row.map((cell) => `"${cell}"`).join(",")),
  ].join("\n");

  return csv;
}

/**
 * Download CSV file
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/**
 * Validate reward configuration
 */
export interface RewardValidation {
  valid: boolean;
  errors: string[];
}

export function validateReward(reward: any): RewardValidation {
  const errors: string[] = [];

  if (!reward.name || reward.name.trim() === "") {
    errors.push("Reward name is required");
  }

  if (reward.drawRangeMin >= reward.drawRangeMax) {
    errors.push("Draw range min must be less than max");
  }

  if (reward.rewardAmount <= 0) {
    errors.push("Reward amount must be greater than 0");
  }

  if (reward.redemptionLimit < 0) {
    errors.push("Redemption limit cannot be negative");
  }

  if (reward.rewardMints.length === 0) {
    errors.push("At least one mint is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format rewards for export/import
 */
export function formatRewardsForExport(rewards: any[]) {
  return rewards.map((reward) => ({
    name: reward.name,
    drawRangeMin: reward.drawRangeMin,
    drawRangeMax: reward.drawRangeMax,
    rewardType: Object.keys(reward.rewardType)[0],
    rewardMints: reward.rewardMints.map((m: PublicKey) => m.toString()),
    rewardAmount: reward.rewardAmount.toString(),
    redemptionLimit: reward.redemptionLimit.toString(),
  }));
}
