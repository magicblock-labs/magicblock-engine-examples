import { PublicKey } from "@solana/web3.js";
import {
  PROGRAM_ID,
  REWARD_DISTRIBUTOR_SEED,
  REWARD_LIST_SEED,
  TRANSFER_LOOKUP_TABLE_SEED,
} from "./constants";

export class PDAs {
  static getRewardDistributor(wallet: PublicKey): [PublicKey, number] {
    const [pda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from(REWARD_DISTRIBUTOR_SEED), wallet.toBuffer()],
      PROGRAM_ID
    );
    return [pda, bump];
  }

  static getRewardList(rewardDistributor: PublicKey): [PublicKey, number] {
    const [pda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from(REWARD_LIST_SEED), rewardDistributor.toBuffer()],
      PROGRAM_ID
    );
    return [pda, bump];
  }

  static getTransferLookupTable(): [PublicKey, number] {
    const [pda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from(TRANSFER_LOOKUP_TABLE_SEED)],
      PROGRAM_ID
    );
    return [pda, bump];
  }
}
