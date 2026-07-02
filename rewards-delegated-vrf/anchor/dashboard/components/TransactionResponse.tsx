"use client";

import React from "react";
import { CheckCircle, AlertCircle, Copy } from "lucide-react";

interface TransactionResponseProps {
  success: boolean;
  signature?: string;
  error?: string;
  onDismiss?: () => void;
  title?: string;
}

export const TransactionResponse: React.FC<TransactionResponseProps> = ({
  success,
  signature,
  error,
  onDismiss,
  title,
}) => {
  const handleCopySignature = () => {
    if (signature) {
      navigator.clipboard.writeText(signature);
    }
  };

  const getExplorerUrl = (sig: string) => {
    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "";
    if (rpcUrl.includes("magicblock")) {
      return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;
    }
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  };

  if (success && signature) {
    return (
      <div className="p-4 bg-green-900/20 border border-green-700 rounded-lg">
        <div className="flex gap-3">
          <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-green-300 mb-1">
              {title || "Transaction Successful"}
            </h3>
            <p className="text-sm text-green-400 mb-2">
              Your transaction has been confirmed
            </p>
            <div className="flex items-center gap-2 p-2 bg-gray-900 rounded border border-gray-700 mb-3">
              <code className="text-xs text-green-300 flex-1 break-all">
                {signature}
              </code>
              <button
                onClick={handleCopySignature}
                className="p-1 hover:bg-gray-800 rounded transition flex-shrink-0"
                title="Copy signature"
              >
                <Copy className="w-4 h-4 text-gray-400 hover:text-gray-200" />
              </button>
            </div>
            <div className="flex gap-2">
              <a
                href={getExplorerUrl(signature)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                View on Explorer
              </a>
              {onDismiss && (
                <button
                  onClick={onDismiss}
                  className="text-xs text-gray-400 hover:text-gray-300"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg">
        <div className="flex gap-3">
          <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-red-300 mb-1">
              {title || "Transaction Failed"}
            </h3>
            <p className="text-sm text-red-400 mb-2 break-words">{error}</p>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="text-xs text-red-400 hover:text-red-300 underline"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
};
