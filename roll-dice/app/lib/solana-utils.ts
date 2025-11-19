import { Keypair, PublicKey, Transaction, VersionedTransaction, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk"
import { MIN_BALANCE_LAMPORTS, BLOCKHASH_CACHE_MAX_AGE_MS } from "./config"
import type { CachedBlockhash } from "./types"

export const walletAdapterFrom = (keypair: Keypair) => ({
  publicKey: keypair.publicKey,
  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    // @ts-ignore - Transaction and VersionedTransaction have different sign signatures
    transaction.sign(keypair)
    return transaction
  },
  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    // @ts-ignore - Transaction and VersionedTransaction have different sign signatures
    transactions.forEach(tx => tx.sign(keypair))
    return transactions
  },
})

export const loadOrCreateKeypair = (storageKey: string): Keypair => {
  if (typeof window === "undefined") return Keypair.generate()
  const stored = window.localStorage.getItem(storageKey)
  if (stored) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)))
  }
  const generated = Keypair.generate()
  window.localStorage.setItem(storageKey, JSON.stringify(Array.from(generated.secretKey)))
  return generated
}

export const ensureFunds = async (connection: Connection, keypair: Keypair): Promise<void> => {
  const balance = await connection.getBalance(keypair.publicKey)
  if (balance < MIN_BALANCE_LAMPORTS * LAMPORTS_PER_SOL) {
    const signature = await connection.requestAirdrop(keypair.publicKey, LAMPORTS_PER_SOL)
    await connection.confirmTransaction(signature, "confirmed")
  }
}

export const fetchAndCacheBlockhash = async (
  connection: Connection,
  cacheRef: { current: CachedBlockhash | null }
): Promise<void> => {
  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    cacheRef.current = {
      blockhash,
      lastValidBlockHeight,
      timestamp: Date.now(),
    }
  } catch (error) {
    console.error("Failed to fetch blockhash:", error)
  }
}

export const getCachedBlockhash = (
  connection: Connection,
  cacheRef: { current: CachedBlockhash | null }
): string | null => {
  const cached = cacheRef.current
  if (!cached) return null
  
  const age = Date.now() - cached.timestamp
  if (age > BLOCKHASH_CACHE_MAX_AGE_MS) {
    fetchAndCacheBlockhash(connection, cacheRef)
  }
  
  return cached.blockhash
}

export const checkDelegationStatus = async (
  connection: Connection,
  accountPubkey: PublicKey
): Promise<boolean> => {
  const accountInfo = await connection.getAccountInfo(accountPubkey)
  return !!accountInfo && accountInfo.owner.equals(DELEGATION_PROGRAM_ID)
}

