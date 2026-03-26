import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TransactionSignature } from "@solana/web3.js";
import { getExplorerUrl } from "@/lib/clusterContext";

export interface HistoryTransaction {
  id: string;
  signature: TransactionSignature;
  actionName: string;
  timestamp: number;
  status: "pending" | "confirmed" | "failed";
  error?: string;
  explorerUrl: string;
  endpoint?: string;
}

interface TransactionHistoryStore {
  transactions: HistoryTransaction[];
  addTransaction: (
    signature: TransactionSignature,
    actionName: string,
    network?: "devnet" | "mainnet-beta",
    endpoint?: string
  ) => string;
  updateTransaction: (
    txId: string,
    updates: Partial<Omit<HistoryTransaction, "id" | "signature">>
  ) => void;
  removeTransaction: (txId: string) => void;
  clearHistory: () => void;
}

export const useGlobalTransactionHistory = create<TransactionHistoryStore>()(
  persist(
    (set) => ({
      transactions: [],

    addTransaction: (signature, actionName, network = "devnet", endpoint) => {
      // Use the endpoint to generate the correct explorer URL
      const explorerUrl = endpoint 
        ? getExplorerUrl(signature, endpoint)
        : `https://explorer.solana.com/tx/${signature}${
            network === "devnet" ? "?cluster=devnet" : ""
          }`;

      const txId = `${signature}-${Date.now()}`;

      const transaction: HistoryTransaction = {
        id: txId,
        signature,
        actionName,
        timestamp: Date.now(),
        status: "pending",
        explorerUrl,
        endpoint,
      };
      set((state) => {
        return {
          transactions: [transaction, ...state.transactions],
        };
      });

      return txId;
    },

    updateTransaction: (txId, updates) => {
      set((state) => ({
        transactions: state.transactions.map((tx) => {
          if (tx.id !== txId) {
            return tx;
          }

          const nextTx = { ...tx, ...updates };
          if (nextTx.endpoint) {
            nextTx.explorerUrl = getExplorerUrl(nextTx.signature, nextTx.endpoint);
          }

          return nextTx;
        }),
      }));
    },

    removeTransaction: (txId) => {
      set((state) => ({
        transactions: state.transactions.filter((tx) => tx.id !== txId),
      }));
    },

    clearHistory: () => {
      set({ transactions: [] });
    },
    }),
    {
     name: "transaction-history-storage",
    }
    )
    );
