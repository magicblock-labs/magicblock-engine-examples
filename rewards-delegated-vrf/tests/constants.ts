import { PublicKey } from "@solana/web3.js";

export const REWARD_DISTRIBUTOR_SEED = "reward_distributor";
export const REWARD_LIST_SEED = "reward_list";
export const TRANSFER_LOOKUP_TABLE_SEED = "transfer_lookup_table";
export const MPL_TOKEN_METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export const AIRDROP_AMOUNT_SOL = 2;
export const MIN_BALANCE_SOL = 0.1;

export const TOKEN_MINT = new PublicKey("BbhNpb7RpkfVd2EtMX4z7mEAZmzsAUZmSqYBmMFWUMM9");
export const TOKEN_DECIMALS = 6;
export const DISTRIBUTOR_MINT_AMOUNT = 5000 * Math.pow(10, TOKEN_DECIMALS);

export const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
