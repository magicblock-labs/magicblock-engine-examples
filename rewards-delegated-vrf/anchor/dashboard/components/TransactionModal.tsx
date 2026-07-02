"use client";

import React, { useRef } from "react";
import { X, AlertCircle, CheckCircle, Loader } from "lucide-react";
import { getExplorerUrl } from "@/lib/clusterContext";

export interface TransactionModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  loading: boolean;
  error: string | null;
  signature: string | null;
  endpoint?: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onMintAgain?: () => void;
  children?: React.ReactNode;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  title,
  description,
  loading,
  error,
  signature,
  endpoint,
  onClose,
  onConfirm,
  onMintAgain,
  children,
}) => {
  if (!isOpen) return null;

  const backdropMouseDown = useRef(false);

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    backdropMouseDown.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (backdropMouseDown.current && e.target === e.currentTarget && !loading) {
      onClose();
    }
    backdropMouseDown.current = false;
  };

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        className="bg-gray-800 rounded-lg max-w-md w-full p-6 border border-gray-700"
        onMouseDown={() => {
          backdropMouseDown.current = false;
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-gray-400 hover:text-white disabled:cursor-not-allowed"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {description && <p className="text-gray-400 text-sm mb-4">{description}</p>}

        {/* Content */}
        {children && <div className="mb-4 space-y-3">{children}</div>}

        {/* Status Messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-900/20 border border-red-700 rounded-lg flex gap-2">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-400 text-sm font-medium">Error</p>
              <p className="text-red-300 text-xs mt-1 whitespace-pre-wrap break-words">
                {error}
              </p>
            </div>
          </div>
        )}

        {signature && !error && (
          <div className="mb-4 p-3 bg-green-900/20 border border-green-700 rounded-lg flex gap-2">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-green-400 text-sm font-medium">Success</p>
              <p className="text-green-300 text-xs mt-1 mb-1">Transaction Signature:</p>
              <a
                href={endpoint ? getExplorerUrl(signature, endpoint) : `https://explorer.solana.com/tx/${signature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 text-xs break-all underline"
              >
                {signature}
              </a>
            </div>
          </div>
        )}

        {signature && error && (
          <div className="mb-4 p-3 bg-blue-900/20 border border-blue-700 rounded-lg flex gap-2">
            <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-blue-400 text-sm font-medium">Transaction Signature</p>
              <a
                href={endpoint ? getExplorerUrl(signature, endpoint) : `https://explorer.solana.com/tx/${signature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-300 hover:text-blue-200 text-xs break-all underline mt-1 block"
              >
                {signature}
              </a>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {signature ? "Close" : "Cancel"}
          </button>
          {!signature && (
            <button
              onClick={onConfirm}
              disabled={loading}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Confirm"
              )}
            </button>
          )}
          {signature && !error && onMintAgain && (
            <button
              onClick={onMintAgain}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
            >
              Mint Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
