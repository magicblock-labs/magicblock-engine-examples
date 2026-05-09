import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";

export async function buildSplTokenTransfer(
  connection: Connection,
  publicKey: PublicKey,
  distributorPda: PublicKey,
  tokenMint: PublicKey,
  amount: number,
  decimals: number
): Promise<Transaction> {
  const userTokenAccount = getAssociatedTokenAddressSync(tokenMint, publicKey);
  const distributorTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    distributorPda,
    true // allowOffCurve for PDAs
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
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  tx.add(
    createTransferInstruction(
      userTokenAccount,
      distributorTokenAccount,
      publicKey,
      Math.floor(amount * Math.pow(10, decimals)),
      [],
      TOKEN_PROGRAM_ID
    )
  );

  return tx;
}
