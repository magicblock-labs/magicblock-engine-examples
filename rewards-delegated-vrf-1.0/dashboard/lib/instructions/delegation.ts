import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { PDAs } from "@/lib/pda";
import { createReadonlyProvider, createProgram } from "@/lib/sendTransaction";

export async function buildDelegateRewardList(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey,
  validator?: PublicKey
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];

  let txBuilder = program.methods.delegateRewardList().accounts({
    admin: publicKey,
    rewardDistributor: rewardDistributorPda,
    rewardList: rewardListPda,
    systemProgram: anchor.web3.SystemProgram.programId,
  } as any);

  if (validator) {
    txBuilder = txBuilder.remainingAccounts([
      { pubkey: validator, isSigner: false, isWritable: false },
    ]);
  }

  return txBuilder.transaction();
}

export async function buildUndelegateRewardList(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];
  return program.methods
    .undelegateRewardList()
    .accounts({
      payer: publicKey,
      rewardDistributor: rewardDistributorPda,
      rewardList: rewardListPda,
    } as any)
    .transaction();
}
