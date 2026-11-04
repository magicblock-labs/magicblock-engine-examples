import { Keypair } from "@solana/web3.js";
import { invariant } from "./config";

// A local embedded wallet: a keypair kept in IndexedDB, encrypted with a
// non-extractable AES key that also lives there. It signs without popups, which
// is what makes ER transactions feel instant. It is a devnet convenience: anyone
// with access to this browser profile can use the wallet, so let users export
// the key and use a real wallet for anything valuable.

const DB_NAME = "gasless-starter-wallet";
const STORE = "wallet";

interface StoredWallet {
  publicKey: string;
  key: CryptoKey;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(new Error("Browser storage is unavailable."));
    open.onsuccess = () => {
      const db = open.result;
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.transaction!.oncomplete = () => db.close();
    };
  });
}

async function save(wallet: Keypair) {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    wallet.secretKey,
  );
  const stored: StoredWallet = {
    publicKey: wallet.publicKey.toBase58(),
    key,
    iv,
    ciphertext,
  };
  await withStore("readwrite", (store) => store.put(stored, "primary"));
}

/** Load the wallet saved in this browser, or create one on first visit. */
export async function openWallet(): Promise<Keypair> {
  invariant(crypto.subtle, "Open the app over HTTPS or localhost.");
  const stored = await withStore<StoredWallet | undefined>("readonly", (s) =>
    s.get("primary"),
  );
  if (!stored) {
    const wallet = Keypair.generate();
    await save(wallet);
    return wallet;
  }
  const secret = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: stored.iv },
    stored.key,
    stored.ciphertext,
  );
  const wallet = Keypair.fromSecretKey(new Uint8Array(secret));
  invariant(
    wallet.publicKey.toBase58() === stored.publicKey,
    "Wallet storage is damaged. Import your backup file.",
  );
  return wallet;
}

/** Download the secret key as a Solana CLI-compatible JSON file. */
export function exportWallet(wallet: Keypair) {
  const file = new Blob([JSON.stringify(Array.from(wallet.secretKey))], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = `gasless-starter-${wallet.publicKey.toBase58().slice(0, 8)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Replace the wallet in this browser with one from a backup file. */
export async function importWallet(file: File): Promise<Keypair> {
  const secret: unknown = JSON.parse(await file.text());
  invariant(
    Array.isArray(secret) &&
      secret.length === 64 &&
      secret.every((byte) => Number.isInteger(byte) && byte >= 0 && byte < 256),
    "This is not a wallet backup file.",
  );
  const wallet = Keypair.fromSecretKey(Uint8Array.from(secret));
  await save(wallet);
  return wallet;
}
