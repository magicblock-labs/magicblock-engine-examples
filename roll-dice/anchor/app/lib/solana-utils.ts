import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  Connection,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { MIN_BALANCE_LAMPORTS, BLOCKHASH_CACHE_MAX_AGE_MS } from "./config";
import type { CachedBlockhash } from "./types";

/**
 * Resolve a program's IDL by trying the bundled local copy first, then falling
 * back to `Program.fetchIdl` against the on-chain IDL account. Useful when:
 *  - You change `declare_id!` and rebuild but forget to copy the new IDL into
 *    the app — local lookup returns a mismatched address, we fall through to
 *    the chain copy (if `anchor idl init` was run).
 *  - The on-chain IDL account hasn't been uploaded — we still work via local.
 *
 * Throws only if both sources are missing or address-mismatched.
 */
export async function loadIdl(
  programId: PublicKey,
  provider: anchor.Provider,
  localIdl: any,
): Promise<anchor.Idl> {
  if (localIdl?.address === programId.toBase58()) {
    return localIdl as anchor.Idl;
  }
  const remote = await anchor.Program.fetchIdl(programId, provider).catch(
    () => null,
  );
  if (remote) return remote as anchor.Idl;
  // Last-resort: hand back the local IDL anyway. The address mismatch will
  // surface as an Anchor error on first ix build, with a clearer message
  // ("program id mismatch") than the generic "IDL not found".
  if (localIdl) return localIdl as anchor.Idl;
  throw new Error(
    `IDL not found locally or on-chain for ${programId.toBase58()}`,
  );
}

export const walletAdapterFrom = (keypair: Keypair) => ({
  publicKey: keypair.publicKey,
  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    // @ts-ignore - Transaction and VersionedTransaction have different sign signatures
    transaction.sign(keypair);
    return transaction;
  },
  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    // @ts-ignore - Transaction and VersionedTransaction have different sign signatures
    transactions.forEach((tx) => tx.sign(keypair));
    return transactions;
  },
});

export const loadOrCreateKeypair = (storageKey: string): Keypair => {
  if (typeof window === "undefined") return Keypair.generate();
  const stored = window.localStorage.getItem(storageKey);
  if (stored) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
  }
  const generated = Keypair.generate();
  window.localStorage.setItem(
    storageKey,
    JSON.stringify(Array.from(generated.secretKey)),
  );
  return generated;
};

export const ensureFunds = async (
  connection: Connection,
  keypair: Keypair,
): Promise<void> => {
  const balance = await connection.getBalance(keypair.publicKey);
  if (balance < MIN_BALANCE_LAMPORTS * LAMPORTS_PER_SOL) {
    const signature = await connection.requestAirdrop(
      keypair.publicKey,
      LAMPORTS_PER_SOL,
    );
    await connection.confirmTransaction(signature, "confirmed");
  }
};

export const fetchAndCacheBlockhash = async (
  connection: Connection,
  cacheRef: { current: CachedBlockhash | null },
): Promise<void> => {
  try {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    cacheRef.current = {
      blockhash,
      lastValidBlockHeight,
      timestamp: Date.now(),
      endpoint: connection.rpcEndpoint,
    };
  } catch (error) {
    console.error("Failed to fetch blockhash:", error);
  }
};

export const getCachedBlockhash = (
  connection: Connection,
  cacheRef: { current: CachedBlockhash | null },
): string | null => {
  const cached = cacheRef.current;
  if (!cached) return null;
  if (cached.endpoint !== connection.rpcEndpoint) return null;

  const age = Date.now() - cached.timestamp;
  if (age > BLOCKHASH_CACHE_MAX_AGE_MS) {
    // Trigger refresh in background but don't return stale blockhash
    fetchAndCacheBlockhash(connection, cacheRef).catch(console.error);
    return null;
  }

  return cached.blockhash;
};

export const checkDelegationStatus = async (
  connection: Connection,
  accountPubkey: PublicKey,
): Promise<boolean> => {
  const accountInfo = await connection.getAccountInfo(accountPubkey);
  return !!accountInfo && accountInfo.owner.equals(DELEGATION_PROGRAM_ID);
};
