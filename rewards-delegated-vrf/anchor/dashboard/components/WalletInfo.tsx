"use client";

import React, { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Copy, Check } from "lucide-react";
import { Wallet } from "lucide-react";

export function WalletInfo() {
  const { publicKey, connected } = useWallet();
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="card h-32" />;
  }

  if (!connected || !publicKey) {
    return (
      <div className="card">
        <div className="text-center py-8">
          <Wallet className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">Connect your wallet to view data</p>
        </div>
      </div>
    );
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(publicKey.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-white">Connected Wallet</h2>
        <span className="px-3 py-1 bg-green-900 text-green-200 text-xs rounded-full font-medium">
          Connected
        </span>
      </div>

      <div className="bg-gray-700 rounded-lg p-4">
        <p className="text-gray-400 text-sm mb-2">Address</p>
        <div className="flex items-center justify-between">
          <p className="font-mono text-white text-lg break-all">
            {publicKey.toString()}
          </p>
          <button
            onClick={copyToClipboard}
            className="ml-3 p-2 text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0"
          >
            {copied ? (
              <Check className="w-5 h-5 text-green-400" />
            ) : (
              <Copy className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
