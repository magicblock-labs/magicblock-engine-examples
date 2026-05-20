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
 * Format a Solana TransactionError into a readable string. For
 * `InstructionError`, also extracts the inner discriminant (`Custom(N)`,
 * `ProgramFailedToComplete`, etc.) for clarity.
 */
function formatTxError(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "object" && "InstructionError" in err) {
    const [index, content] = (err as any).InstructionError;
    if (typeof content === "string") {
      return `Instruction ${index} failed: ${content}`;
    }
    if (content && typeof content === "object") {
      const key = Object.keys(content)[0];
      const val = (content as any)[key];
      return `Instruction ${index} failed: ${key}${
        val !== undefined && val !== null ? `(${JSON.stringify(val)})` : ""
      }`;
    }
    return `Instruction ${index} failed: ${JSON.stringify(content)}`;
  }
  return typeof err === "string" ? err : JSON.stringify(err);
}

/**
 * After a confirmed-but-failed tx, pull program logs to produce a more
 * actionable error message (e.g. anchor's `Error Code: SomeError. Error Number: 6000`).
 * Best-effort — falls back to the raw err if logs aren't available yet.
 */
async function enrichErrorWithLogs(
  connection: Connection,
  signature: string,
  rawErr: unknown
): Promise<string> {
  const base = formatTxError(rawErr);
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx?.meta?.logMessages ?? [];
    // Anchor-style error lines are the most useful.
    const anchorErr = logs.find((line) => line.includes("Error Code:"));
    if (anchorErr) return `${base} — ${anchorErr.trim()}`;
    // Otherwise, last "Program log:" line often holds a custom msg.
    const lastLog = [...logs].reverse().find((line) => line.startsWith("Program log:"));
    if (lastLog) return `${base} — ${lastLog.trim()}`;
    return base;
  } catch {
    return base;
  }
}

/**
 * Sign (with wallet adapter) and send a transaction.
 *
 * Resolution policy:
 *   - On-chain err from confirmTransaction → success: false (with logs if available).
 *   - Confirm timeout AND no signature status found → success: false ("pending"),
 *     never silently green.
 *   - Confirm timeout BUT status reports err → success: false.
 *   - Confirm timeout AND status reports no err but exists → success: true.
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
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    const signedTx = await signTransaction(tx);
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    // Primary path: blockhash-aware confirm. Returns err in its result if the
    // tx landed and the program returned an error. Distinguishes confirmed
    // (success-or-on-chain-fail) from timed-out (status unknown).
    let confirmedErr: unknown = null;
    let confirmed = false;
    try {
      const result = await Promise.race([
        connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed"
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 60_000)),
      ]);
      if (result && "value" in result) {
        confirmed = true;
        confirmedErr = result.value.err;
      }
    } catch (err) {
      // Treat any thrown confirmation error as "not confirmed yet" — we'll
      // fall through to the explicit status check below.
      void err;
    }

    if (confirmed) {
      if (confirmedErr) {
        const error = await enrichErrorWithLogs(connection, signature, confirmedErr);
        return { success: false, signature, error, endpoint };
      }
      return { success: true, signature, endpoint };
    }

    // Fallback: status lookup. Use `searchTransactionHistory: true` so we
    // also pick up signatures that have aged out of the recent-status cache.
    try {
      const { value } = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = value[0];
      if (status === null) {
        return {
          success: false,
          signature,
          error:
            "Transaction submitted but not confirmed within 60s. It may still land — check explorer.",
          endpoint,
        };
      }
      if (status.err) {
        const error = await enrichErrorWithLogs(connection, signature, status.err);
        return { success: false, signature, error, endpoint };
      }
      return { success: true, signature, endpoint };
    } catch {
      return {
        success: false,
        signature,
        error:
          "Transaction sent but status lookup failed. It may still land — check explorer.",
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
 *
 * Same on-chain-error handling as `sendTransaction` — never claims success
 * when the tx landed with an error or when the status is unknown.
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
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    for (const keypair of extraSigners) {
      tx.partialSign(keypair);
    }

    const signedTx = await signTransaction(tx);
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    let confirmedErr: unknown = null;
    let confirmed = false;
    try {
      const result = await Promise.race([
        connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed"
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 60_000)),
      ]);
      if (result && "value" in result) {
        confirmed = true;
        confirmedErr = result.value.err;
      }
    } catch (err) {
      void err;
    }

    if (confirmed) {
      if (confirmedErr) {
        const error = await enrichErrorWithLogs(connection, signature, confirmedErr);
        return { success: false, signature, error, endpoint };
      }
      return { success: true, signature, endpoint };
    }

    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];
    if (status === null) {
      return {
        success: false,
        signature,
        error:
          "Transaction submitted but not confirmed within 60s. It may still land — check explorer.",
        endpoint,
      };
    }
    if (status.err) {
      const error = await enrichErrorWithLogs(connection, signature, status.err);
      return { success: false, signature, error, endpoint };
    }
    return { success: true, signature, endpoint };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}
