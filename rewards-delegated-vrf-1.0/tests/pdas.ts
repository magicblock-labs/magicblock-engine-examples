import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  REWARD_DISTRIBUTOR_SEED,
  REWARD_LIST_SEED,
  TRANSFER_LOOKUP_TABLE_SEED,
  DELEGATION_PROGRAM_ID,
} from "./constants";

/**
 * PDAs derivation utility
 */
export class PDAs {
  static getRewardDistributor(
    programId: PublicKey,
    wallet: PublicKey
  ): PublicKey {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from(REWARD_DISTRIBUTOR_SEED), wallet.toBytes()],
      programId
    );
    return pda;
  }

  static getRewardList(
    programId: PublicKey,
    rewardDistributorPda: PublicKey
  ): PublicKey {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from(REWARD_LIST_SEED), rewardDistributorPda.toBytes()],
      programId
    );
    return pda;
  }

  static getTransferLookupTable(programId: PublicKey): PublicKey {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from(TRANSFER_LOOKUP_TABLE_SEED)],
      programId
    );
    return pda;
  }

  /** Delegation record PDA for a delegated account (seeds: ["delegation", account]) */
  static getDelegationRecord(delegatedAccount: PublicKey): PublicKey {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("delegation"), delegatedAccount.toBytes()],
      DELEGATION_PROGRAM_ID
    );
    return pda;
  }
}
