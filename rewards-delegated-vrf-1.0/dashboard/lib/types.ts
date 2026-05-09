import { PublicKey } from "@solana/web3.js";

// Anchor deserializes enums as { variantName: {} }
export type RewardType = 
  | { splToken: {} }
  | { legacyNft: {} }
  | { programmableNft: {} }
  | { splToken2022: {} }
  | { compressedNft: {} };

export enum RewardTypeEnum {
  SplToken = 0,
  LegacyNft = 1,
  ProgrammableNft = 2,
  SplToken2022 = 3,
  CompressedNft = 4,
}

export interface Reward {
  name: string;
  drawRangeMin: number;
  drawRangeMax: number;
  rewardType: RewardType;
  rewardMints: PublicKey[];
  rewardAmount: bigint;
  redemptionCount: bigint;
  redemptionLimit: bigint;
  additionalPubkeys: PublicKey[];
}

export interface RewardDistributor {
  superAdmin: PublicKey;
  bump: number;
  admins: PublicKey[];
  whitelist: PublicKey[];
  delegated?: boolean;
}

export interface RewardsList {
  rewardDistributor: PublicKey;
  bump: number;
  rewards: Reward[];
  startTimestamp: bigint;
  endTimestamp: bigint;
  globalRangeMin: number;
  globalRangeMax: number;
  delegated?: boolean;
}

export interface TransferLookupTable {
  bump: number;
  lookupAccounts: PublicKey[];
}

export interface TokenMetadata {
  mint: PublicKey;
  decimals: number;
  symbol: string;
  name: string;
  image?: string;
}

export interface NFTMetadata {
  mint: PublicKey;
  name: string;
  image?: string;
  collection?: PublicKey;
}
