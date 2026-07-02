import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

export const loadOrCreateKeypair = (storageKey: string): Keypair => {
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
    // @ts-ignore
    transactions.forEach((tx) => tx.sign(keypair));
    return transactions;
  },
});

export const shortKey = (pk: PublicKey | string, chars = 4): string => {
  const s = typeof pk === "string" ? pk : pk.toBase58();
  return `${s.slice(0, chars)}…${s.slice(-chars)}`;
};

export const getSolBalance = async (
  connection: Connection,
  pubkey: PublicKey,
): Promise<number> => (await connection.getBalance(pubkey)) / LAMPORTS_PER_SOL;

export const requestAirdrop = async (
  connection: Connection,
  pubkey: PublicKey,
  sol: number,
): Promise<void> => {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
};

export const transferSol = async (
  connection: Connection,
  from: Keypair,
  to: PublicKey,
  sol: number,
): Promise<string> => {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: Math.round(sol * LAMPORTS_PER_SOL),
    }),
  );
  tx.feePayer = from.publicKey;
  return sendAndConfirmTransaction(connection, tx, [from], {
    skipPreflight: true,
    commitment: "confirmed",
  });
};
