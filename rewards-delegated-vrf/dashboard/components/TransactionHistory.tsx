"use client";

import React from "react";
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

  if (transactions.length === 0) {
    return (
      <div className="card p-6 text-center">
        <p className="text-gray-400">No transactions yet</p>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <h3 className="text-lg font-semibold text-white mb-4">Transaction History</h3>
      
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {transactions.map((tx) => (
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
    </div>
  );
};
