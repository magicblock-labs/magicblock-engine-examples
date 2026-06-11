import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import {
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { PDAs } from "@/lib/pda";
import { createReadonlyProvider, createProgram } from "@/lib/sendTransaction";

export async function buildSplTokenTransfer(
  connection: Connection,
  publicKey: PublicKey,
  distributorPda: PublicKey,
  tokenMint: PublicKey,
  amount: number,
  decimals: number,
): Promise<Transaction> {
  const userTokenAccount = getAssociatedTokenAddressSync(tokenMint, publicKey);
  const distributorTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    distributorPda,
    true, // allowOffCurve for PDAs
  );

  const tx = new Transaction();

  // Create the distributor ATA if it doesn't exist yet
  try {
    await getAccount(connection, distributorTokenAccount);
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        publicKey,
        distributorTokenAccount,
        distributorPda,
        tokenMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  tx.add(
    createTransferInstruction(
      userTokenAccount,
      distributorTokenAccount,
      publicKey,
      Math.floor(amount * Math.pow(10, decimals)),
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  return tx;
}

/**
 * Whitelist transfer: move SPL tokens from the per-distributor
 * `whitelist_distributor` PDA to a user. Signer must be either:
 *   - the reward distributor's `super_admin`,
 *   - one of `reward_distributor.admins`, OR
 *   - one of `reward_distributor.whitelist`.
 *
 * Runs on the ER — same Magic intent infrastructure as admin_transfer.
 * `reward_list` must be delegated; the post-commit handler signs the SPL
 * CPI with the whitelist_distributor PDA's seeds on base layer.
 */
export async function buildWhitelistTransfer(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey,
  tokenMint: PublicKey,
  user: PublicKey,
  amount: number,
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);

  const whitelistDistributorPda =
    PDAs.getWhitelistDistributor(rewardDistributorPda)[0];
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];
  const transferLookupTablePda = PDAs.getTransferLookupTable()[0];
  const sourceTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    whitelistDistributorPda,
    true,
  );
  const delegationRecord = PDAs.getDelegationRecord(rewardListPda)[0];

  // magic_fee_vault is derived from the validator that owns the reward_list
  // delegation. Read it from the delegation-record account: bytes [8..40]
  // hold the authority pubkey (= validator).
  const delegationRecordInfo = await connection.getAccountInfo(
    delegationRecord,
    "confirmed",
  );
  if (!delegationRecordInfo || delegationRecordInfo.data.length < 40) {
    throw new Error(
      "Reward list delegation record not found — delegate reward_list to the ER first.",
    );
  }
  const validator = new PublicKey(delegationRecordInfo.data.subarray(8, 40));
  const magicFeeVault = PDAs.getMagicFeeVault(validator)[0];

  // The program treats `amount` as UI units (multiplies by 10^decimals
  // internally), matching admin_transfer / transfer_spl_token convention.
  return program.methods
    .whitelistTransfer(new BN(amount))
    .accounts({
      signer: publicKey,
      rewardDistributor: rewardDistributorPda,
      whitelistDistributor: whitelistDistributorPda,
      rewardList: rewardListPda,
      transferLookupTable: transferLookupTablePda,
      mint: tokenMint,
      sourceTokenAccount,
      user,
      delegationRecordRewardList: delegationRecord,
      magicFeeVault,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    } as any)
    .transaction();
}
