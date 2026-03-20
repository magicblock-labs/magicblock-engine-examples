import { create } from "zustand";
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

export const useGlobalTransactionHistory = create<TransactionHistoryStore>(
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

      console.log("[useGlobalTransactionHistory] Adding transaction:", transaction);

      set((state) => {
        const newState = {
          transactions: [transaction, ...state.transactions],
        };
        console.log("[useGlobalTransactionHistory] New transactions state:", newState.transactions);
        return newState;
      });

      return txId;
    },

    updateTransaction: (txId, updates) => {
      set((state) => ({
        transactions: state.transactions.map((tx) =>
          tx.id === txId ? { ...tx, ...updates } : tx
        ),
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
  })
);
