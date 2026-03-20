import { useState, useCallback } from "react";
import { TransactionSignature } from "@solana/web3.js";

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

export const useTransactionHistory = () => {
  const [transactions, setTransactions] = useState<HistoryTransaction[]>([]);

  const addTransaction = useCallback(
    (
      signature: TransactionSignature,
      actionName: string,
      network: "devnet" | "mainnet-beta" = "devnet",
      endpoint?: string
    ) => {
      const explorerUrl = `https://explorer.solana.com/tx/${signature}${
        network === "devnet" ? "?cluster=devnet" : ""
      }`;

      const transaction: HistoryTransaction = {
        id: `${signature}-${Date.now()}`,
        signature,
        actionName,
        timestamp: Date.now(),
        status: "pending",
        explorerUrl,
        endpoint,
      };

      setTransactions((prev) => [transaction, ...prev]);
      return transaction.id;
    },
    []
  );

  const updateTransaction = useCallback(
    (
      txId: string,
      updates: Partial<Omit<HistoryTransaction, "id" | "signature">>
    ) => {
      setTransactions((prev) =>
        prev.map((tx) => (tx.id === txId ? { ...tx, ...updates } : tx))
      );
    },
    []
  );

  const clearHistory = useCallback(() => {
    setTransactions([]);
  }, []);

  const removeTransaction = useCallback((txId: string) => {
    setTransactions((prev) => prev.filter((tx) => tx.id !== txId));
  }, []);

  return {
    transactions,
    addTransaction,
    updateTransaction,
    clearHistory,
    removeTransaction,
  };
};
