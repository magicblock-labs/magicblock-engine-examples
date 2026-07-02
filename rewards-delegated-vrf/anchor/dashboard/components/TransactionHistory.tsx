"use client";

import React, { useEffect, useMemo, useState } from "react";
import { HistoryTransaction } from "@/hooks/useGlobalTransactionHistory";
import { ExternalLink, Trash2, Copy, CheckCircle, AlertCircle, Clock } from "lucide-react";
import { copyToClipboard, shortAddress } from "@/lib/utils";
import { getClusterName, getExplorerUrl } from "@/lib/clusterContext";

interface TransactionHistoryProps {
  transactions: HistoryTransaction[];
  onRemove: (txId: string) => void;
}

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  transactions,
  onRemove,
}) => {
  const pageSize = 10;
  const [currentPage, setCurrentPage] = useState(1);

  const getEndpointLabel = (endpoint: string) => {
    const clusterName = getClusterName(endpoint);
    return clusterName === "Unknown Cluster" ? "Custom RPC" : clusterName;
  };

  const getStatusIcon = (status: "pending" | "confirmed" | "failed") => {
    switch (status) {
      case "confirmed":
        return (
          <CheckCircle className="w-4 h-4 text-green-400" />
        );
      case "failed":
        return (
          <AlertCircle className="w-4 h-4 text-red-400" />
        );
      case "pending":
        return (
          <Clock className="w-4 h-4 text-yellow-400 animate-spin" />
        );
    }
  };

  const getStatusColor = (status: "pending" | "confirmed" | "failed") => {
    switch (status) {
      case "confirmed":
        return "text-green-400";
      case "failed":
        return "text-red-400";
      case "pending":
        return "text-yellow-400";
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const totalPages = Math.max(1, Math.ceil(transactions.length / pageSize));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const visibleTransactions = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return transactions.slice(startIndex, startIndex + pageSize);
  }, [currentPage, transactions]);

  if (transactions.length === 0) {
    return (
      <div className="card p-6 text-center">
        <p className="text-gray-400">No transactions yet</p>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-white">Transaction History</h3>
        <span className="text-xs text-gray-400">
          Page {currentPage} of {totalPages}
        </span>
      </div>
      
      <div className="space-y-2">
        {visibleTransactions.map((tx) => (
          <div
            key={tx.id}
            className="bg-gray-700 p-3 rounded border border-gray-600 flex items-center justify-between hover:bg-gray-650 transition"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Status Icon */}
              <div className="flex-shrink-0">
                {getStatusIcon(tx.status)}
              </div>

              {/* Transaction Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">
                    {tx.actionName}
                  </span>
                  <span className={`text-xs font-medium ${getStatusColor(tx.status)}`}>
                    {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <code className="text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded truncate">
                    {shortAddress(tx.signature, 6)}
                  </code>
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {formatTime(tx.timestamp)}
                  </span>
                  {tx.endpoint && (
                    <span
                      className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded truncate"
                      title={tx.endpoint}
                    >
                      {getEndpointLabel(tx.endpoint)}
                    </span>
                  )}
                </div>

                {tx.error && (
                  <p className="text-xs text-red-400 mt-1 truncate">{tx.error}</p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
              <button
                onClick={() => copyToClipboard(tx.signature)}
                className="p-1 hover:bg-gray-600 rounded transition"
                title="Copy signature"
              >
                <Copy className="w-4 h-4 text-gray-400 hover:text-white" />
              </button>

              <a
                href={tx.endpoint ? getExplorerUrl(tx.signature, tx.endpoint) : tx.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:bg-gray-600 rounded transition"
                title="View on explorer"
              >
                <ExternalLink className="w-4 h-4 text-gray-400 hover:text-blue-400" />
              </a>

              <button
                onClick={() => onRemove(tx.id)}
                className="p-1 hover:bg-gray-600 rounded transition"
                title="Remove from history"
              >
                <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-400" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-700 pt-4">
          <button
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={currentPage === 1}
            className="rounded border border-gray-600 px-3 py-2 text-sm text-white transition hover:border-blue-500 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-xs text-gray-400">
            Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, transactions.length)} of {transactions.length}
          </span>
          <button
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            disabled={currentPage === totalPages}
            className="rounded border border-gray-600 px-3 py-2 text-sm text-white transition hover:border-blue-500 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};
