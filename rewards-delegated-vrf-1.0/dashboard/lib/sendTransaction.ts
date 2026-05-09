import { Connection, PublicKey, Transaction, Keypair } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import type { RewardsDelegatedVrf } from "@/idl/rewards_delegated_vrf";
import rewardsDelegatedVrfIdl from "@/idl/rewards_delegated_vrf.json";
import type { TransactionResponse } from "./instructions/types";

/**
 * Readonly Anchor provider — suitable for building transactions via
 * program.methods.xxx().transaction(). The dummy signer is never invoked
 * since .transaction() does not sign.
 */
export function createReadonlyProvider(
  publicKey: PublicKey,
  connection: Connection
): anchor.AnchorProvider {
  const dummyWallet = {
    publicKey,
    signTransaction: async (tx: Transaction) => tx,
    signAllTransactions: async (txs: Transaction[]) => txs,
  } as anchor.Wallet;
  return new anchor.AnchorProvider(connection, dummyWallet, { commitment: "confirmed" });
}

export async function createProgram(
  provider: anchor.AnchorProvider
): Promise<anchor.Program<RewardsDelegatedVrf>> {
  return new anchor.Program<RewardsDelegatedVrf>(
    rewardsDelegatedVrfIdl as anchor.Idl,
    provider
  );
}

/**
 * Sign (with wallet adapter) and send a transaction.
 * Handles blockhash, confirmation polling, and status check.
 */
export async function sendTransaction(
  tx: Transaction,
  publicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  endpoint: string
): Promise<TransactionResponse> {
  try {
    const connection = new Connection(endpoint, "confirmed");
    tx.feePayer = publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const signedTx = await signTransaction(tx);
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    try {
      await Promise.race([
        connection.confirmTransaction(signature, "confirmed"),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Transaction confirmation timeout")), 60_000)
        ),
      ]);
    } catch {
      // fall through to status check
    }

    try {
      const txStatus = await connection.getSignatureStatus(signature);
      if (txStatus.value?.err) {
        let errorMessage = JSON.stringify(txStatus.value.err);
        if (
          typeof txStatus.value.err === "object" &&
          "InstructionError" in txStatus.value.err
        ) {
          const [index, errContent] = (txStatus.value.err as any).InstructionError;
          errorMessage = `Instruction ${index} failed: ${JSON.stringify(errContent)}`;
        }
        return { success: false, signature, error: errorMessage, endpoint };
      }
      return { success: true, signature, endpoint };
    } catch {
      return {
        success: false,
        signature,
        error: "Transaction sent but could not verify status. Check explorer for details.",
        endpoint,
      };
    }
  } catch (err) {
    const error =
      err instanceof Error
        ? err.message
        : typeof err === "object"
        ? JSON.stringify(err)
        : String(err);
    return { success: false, error };
  }
}

/**
 * Variant for transactions that need a generated keypair (e.g. NFT mint)
 * to partially sign before the wallet adapter signs.
 */
export async function sendTransactionWithKeypair(
  tx: Transaction,
  publicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  endpoint: string,
  extraSigners: Keypair[]
): Promise<TransactionResponse> {
  try {
    const connection = new Connection(endpoint, "confirmed");
    tx.feePayer = publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    for (const keypair of extraSigners) {
      tx.partialSign(keypair);
    }

    const signedTx = await signTransaction(tx);
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    await connection.confirmTransaction(signature, "confirmed");
    return { success: true, signature, endpoint };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}
