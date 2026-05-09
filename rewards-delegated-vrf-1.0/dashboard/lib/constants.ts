import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "B78RHyS2oJeyeQmwBiroq4pTm1NmgPbn34MABywirYru"
);

export const REWARD_DISTRIBUTOR_SEED = "reward_distributor";
export const REWARD_LIST_SEED = "reward_list";
export const TRANSFER_LOOKUP_TABLE_SEED = "transfer_lookup_table";

export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);

export const REWARD_TYPES = {
  SplToken: "SplToken",
  LegacyNft: "LegacyNft",
  ProgrammableNft: "ProgrammableNft",
  SplToken2022: "SplToken2022",
  CompressedNft: "CompressedNft",
} as const;
