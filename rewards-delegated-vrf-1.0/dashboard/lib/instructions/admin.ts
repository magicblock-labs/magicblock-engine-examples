import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { PDAs } from "@/lib/pda";
import { createReadonlyProvider, createProgram } from "@/lib/sendTransaction";

export async function buildInitializeDistributor(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey,
  whitelist: PublicKey[] = []
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);
  return program.methods
    .initializeRewardDistributor(whitelist)
    .accounts({
      initializer: publicKey,
      rewardDistributor: rewardDistributorPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .transaction();
}

export async function buildSetAdmins(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey,
  newAdmins: PublicKey[]
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);
  return program.methods
    .setAdmins(newAdmins)
    .accounts({ admin: publicKey, rewardDistributor: rewardDistributorPda } as any)
    .transaction();
}

export async function buildSetWhitelist(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey,
  newWhitelist: PublicKey[]
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);
  return program.methods
    .setWhitelist(newWhitelist)
    .accounts({ admin: publicKey, rewardDistributor: rewardDistributorPda } as any)
    .transaction();
}

export async function buildSetRewardList(
  connection: Connection,
  publicKey: PublicKey,
  rewardDistributorPda: PublicKey,
  globalRangeMin: number | null,
  globalRangeMax: number | null,
  startTimestamp: number | null,
  endTimestamp: number | null
): Promise<Transaction> {
  const provider = createReadonlyProvider(publicKey, connection);
  const program = await createProgram(provider);
  const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];
  return program.methods
    .setRewardList(
      typeof startTimestamp === "number" && startTimestamp > 0
        ? new anchor.BN(startTimestamp)
        : null,
      typeof endTimestamp === "number" && endTimestamp > 0
        ? new anchor.BN(endTimestamp)
        : null,
      typeof globalRangeMin === "number" && Number.isFinite(globalRangeMin)
        ? globalRangeMin
        : null,
      typeof globalRangeMax === "number" && Number.isFinite(globalRangeMax)
        ? globalRangeMax
        : null
    )
    .accounts({
      admin: publicKey,
      rewardDistributor: rewardDistributorPda,
      rewardList: rewardListPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .transaction();
}
