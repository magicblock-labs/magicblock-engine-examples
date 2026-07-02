import { TransactionSignature } from "@solana/web3.js";

export interface TransactionResponse {
  success: boolean;
  signature?: TransactionSignature;
  error?: string;
  endpoint?: string;
  callbackPromise?: Promise<VrfCallbackData | null>;
}

export interface VrfCallbackData {
  signature: string;
  relevantLogs: string[];
  txStatus: "confirmed" | "failed" | "pending";
  error?: string;
}
