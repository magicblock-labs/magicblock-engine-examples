import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { RewardDistributor, RewardsList, TransferLookupTable } from "./types";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { CLUSTER_CONFIG } from "./clusterContext";

// Map endpoints to Solana endpoints for delegation status checking
const getSolanaEndpoint = (endpoint: string): string => {
  // Check for devnet first (devnet-as.magicblock.app, api.devnet.solana.com, etc)
  if (endpoint.includes("devnet")) {
    return CLUSTER_CONFIG["https://rpc.magicblock.app/devnet"].endpoint;
  } 
  // Check for mainnet (mainnet, as.magicblock.app, etc)
  else if (endpoint.includes("mainnet") || endpoint.includes("as.magicblock.app")) {
    return CLUSTER_CONFIG["https://rpc.magicblock.app/mainnet"].endpoint;
  } 
  // Default to devnet
  else {
    return CLUSTER_CONFIG["https://rpc.magicblock.app/devnet"].endpoint;
  }
};

export class ProgramClient {
  private connection: Connection;
  private rpcUrl: string;
  private solanaConnection: Connection;

  constructor(rpcUrl?: string) {
    this.rpcUrl = rpcUrl || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("devnet");
    this.connection = new Connection(this.rpcUrl, "confirmed");
    // Create a separate connection to Solana endpoint for delegation status
    const solanaEndpoint = getSolanaEndpoint(this.rpcUrl);
    this.solanaConnection = new Connection(solanaEndpoint, "confirmed");
  }

  /**
   * Read a string from Borsh format (4-byte length prefix + utf-8 data)
   */
  private readString(data: Buffer, pos: number): { value: string; newPos: number } {
    const length = data.readUInt32LE(pos);
    pos += 4;
    const value = data.toString("utf-8", pos, pos + length);
    return { value, newPos: pos + length };
  }

  /**
   * Manual Borsh deserialization for RewardDistributor
   */
  private deserializeRewardDistributor(data: Buffer): any {
    let pos = 8; // Skip discriminator

    if (data.length < pos + 32) {
      throw new Error(`Buffer too short for RewardDistributor. Expected at least ${pos + 32} bytes, got ${data.length}`);
    }

    // super_admin (pubkey = 32 bytes)
    const superAdmin = new PublicKey(data.slice(pos, pos + 32));
    pos += 32;

    // bump (u8 = 1 byte)
    const bump = data[pos];
    pos += 1;

    // admins (vec of pubkeys)
    const adminsLength = data.readUInt32LE(pos);
    pos += 4;
    const admins: PublicKey[] = [];
    for (let i = 0; i < adminsLength; i++) {
      admins.push(new PublicKey(data.slice(pos, pos + 32)));
      pos += 32;
    }

    // whitelist (vec of pubkeys)
    const whitelistLength = data.readUInt32LE(pos);
    pos += 4;
    const whitelist: PublicKey[] = [];
    for (let i = 0; i < whitelistLength; i++) {
      whitelist.push(new PublicKey(data.slice(pos, pos + 32)));
      pos += 32;
    }

    return { superAdmin, bump, admins, whitelist };
  }

  /**
   * Manual Borsh deserialization for RewardsList
   */
  private deserializeRewardsList(data: Buffer): any {
    let pos = 8; // Skip discriminator

    if (data.length < pos + 32) {
      throw new Error(`Buffer too short for RewardsList. Expected at least ${pos + 32} bytes, got ${data.length}`);
    }

    // reward_distributor (pubkey = 32 bytes)
    const rewardDistributor = new PublicKey(data.slice(pos, pos + 32));
    pos += 32;

    // bump (u8 = 1 byte)
    const bump = data[pos];
    pos += 1;

    // rewards (vec of Reward structs)
    const rewardsLength = data.readUInt32LE(pos);
    pos += 4;
    const rewards: any[] = [];

    for (let i = 0; i < rewardsLength; i++) {
      // name (string)
      const nameResult = this.readString(data, pos);
      pos = nameResult.newPos;
      const name = nameResult.value;

      // draw_range_min (u32)
      const drawRangeMin = data.readUInt32LE(pos);
      pos += 4;

      // draw_range_max (u32)
      const drawRangeMax = data.readUInt32LE(pos);
      pos += 4;

      // reward_type (enum, 1 byte)
      const rewardTypeValue = data[pos];
      pos += 1;
      const rewardTypes = ["splToken", "legacyNft", "programmableNft", "splToken2022", "compressedNft"];
      const rewardType = { [rewardTypes[rewardTypeValue]]: {} };

      // reward_mints (vec of pubkeys)
      const mintsLength = data.readUInt32LE(pos);
      pos += 4;
      const rewardMints: PublicKey[] = [];
      for (let j = 0; j < mintsLength; j++) {
        rewardMints.push(new PublicKey(data.slice(pos, pos + 32)));
        pos += 32;
      }

      // reward_amount (u64)
      const rewardAmount = data.readBigUInt64LE(pos);
      pos += 8;

      // redemption_count (u64)
      const redemptionCount = data.readBigUInt64LE(pos);
      pos += 8;

      // redemption_limit (u64)
      const redemptionLimit = data.readBigUInt64LE(pos);
      pos += 8;

      // additional_pubkeys (vec of pubkeys)
      const additionalLength = data.readUInt32LE(pos);
      pos += 4;
      const additionalPubkeys: PublicKey[] = [];
      for (let j = 0; j < additionalLength; j++) {
        additionalPubkeys.push(new PublicKey(data.slice(pos, pos + 32)));
        pos += 32;
      }

      rewards.push({
        name,
        drawRangeMin,
        drawRangeMax,
        rewardType,
        rewardMints,
        rewardAmount,
        redemptionCount,
        redemptionLimit,
        additionalPubkeys,
      });
    }

    // start_timestamp (i64)
    const startTimestamp = data.readBigInt64LE(pos);
    pos += 8;

    // end_timestamp (i64)
    const endTimestamp = data.readBigInt64LE(pos);
    pos += 8;

    // global_range_min (u32)
    const globalRangeMin = data.readUInt32LE(pos);
    pos += 4;

    // global_range_max (u32)
    const globalRangeMax = data.readUInt32LE(pos);
    pos += 4;

    return {
      rewardDistributor,
      bump,
      rewards,
      startTimestamp,
      endTimestamp,
      globalRangeMin,
      globalRangeMax,
    };
  }

  /**
   * Fetch reward distributor account using manual Borsh deserialization
   */
  async fetchRewardDistributor(pda: PublicKey): Promise<RewardDistributor | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(pda);
      
      // Fetch delegation status from Solana endpoint
      let delegationAccountInfo: any = null;
      try {
        delegationAccountInfo = await this.solanaConnection.getAccountInfo(pda);
      } catch {
        // Ignore delegation lookup failures and continue with base data.
      }
      
      if (!accountInfo) {
        return null;
      }

      // Check if account has meaningful data (at least discriminator + some fields)
      if (accountInfo.data.length < 50) {
        return null;
      }

      // Deserialize using manual Borsh parsing
      const decoded = this.deserializeRewardDistributor(accountInfo.data);

      // Check if account is delegated by comparing owner with delegation program on Solana
      const isDelegated = delegationAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID) || false;

      return {
        superAdmin: decoded.superAdmin as PublicKey,
        bump: decoded.bump as number,
        admins: (decoded.admins as PublicKey[]) || [],
        whitelist: (decoded.whitelist as PublicKey[]) || [],
        delegated: isDelegated,
      };
    } catch (error) {
      console.error("Error fetching reward distributor:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Fetch reward list account using manual Borsh deserialization
   */
  async fetchRewardsList(pda: PublicKey): Promise<RewardsList | null> {
    try {
       const accountInfo = await this.connection.getAccountInfo(pda);
       
       // Fetch delegation status from Solana endpoint
       let delegationAccountInfo: any = null;
       try {
         delegationAccountInfo = await this.solanaConnection.getAccountInfo(pda);
       } catch {
         // Ignore delegation lookup failures and continue with base data.
       }
      
      if (!accountInfo) {
        return null;
      }

      // Check if account has meaningful data (at least discriminator + some fields)
      if (accountInfo.data.length < 50) {
        return null;
      }

      // Deserialize using manual Borsh parsing
      const decoded = this.deserializeRewardsList(accountInfo.data);

      // Check if account is delegated by comparing owner with delegation program on Solana
      const isDelegated = delegationAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID) || false;

      return {
        rewardDistributor: decoded.rewardDistributor as PublicKey,
        bump: decoded.bump as number,
        rewards: (decoded.rewards as any[]) || [],
        startTimestamp: decoded.startTimestamp as bigint,
        endTimestamp: decoded.endTimestamp as bigint,
        globalRangeMin: decoded.globalRangeMin as number,
        globalRangeMax: decoded.globalRangeMax as number,
        delegated: isDelegated,
      };
    } catch (error) {
      console.error("Error fetching reward list:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Fetch transfer lookup table account
   */
  async fetchTransferLookupTable(pda: PublicKey): Promise<TransferLookupTable | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(pda);
      
      if (!accountInfo) {
        return null;
      }

      // Return safe structure
      return {
        bump: 0,
        lookupAccounts: [],
      };
    } catch (error) {
      console.error("Error fetching transfer lookup table:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  getConnection(): Connection {
    return this.connection;
  }

  getRpcUrl(): string {
    return this.rpcUrl;
  }
}
