"use client";

import React, { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Send, Eye } from "lucide-react";
import { useTransaction } from "@/hooks/useTransaction";
import { useGlobalTransactionHistory } from "@/hooks/useGlobalTransactionHistory";
import { getDefaultSolanaEndpoint } from "@/lib/clusterContext";
import { TransactionModal } from "./TransactionModal";
import { PDAs } from "@/lib/pda";

interface ActionForm {
  [key: string]: any;
}

interface DistributorAsset {
  type: "spl-token" | "nft";
  mint: string;
  name?: string;
  balance?: number;
  isInRewardList?: boolean;
}

interface TokenActionsProps {
  selectedDistributor?: PublicKey | null;
}

export const TokenActions: React.FC<TokenActionsProps> = ({ selectedDistributor }) => {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { status, sendSplTokenToDistributor } = useTransaction({ selectedDistributor });
  const { addTransaction, updateTransaction } = useGlobalTransactionHistory();

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState({
    loading: false,
    error: null as string | null,
    signature: null as string | null,
  });
  const [assets, setAssets] = useState<DistributorAsset[]>([]);
  const [forms, setForms] = useState<ActionForm>({
    sendToken: {
      tokenMint: "",
      amount: 0,
      decimals: 6,
    },
  });

  const handleSendToken = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const config = forms.sendToken;
    const result = await sendSplTokenToDistributor(
      new PublicKey(config.tokenMint),
      config.amount,
      config.decimals
    );
    
    if (result.signature) {
      const txId = addTransaction(
        result.signature,
        "Send SPL Token to Distributor",
        "devnet",
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL || getDefaultSolanaEndpoint()
      );
      updateTransaction(txId, {
        status: result.success ? "confirmed" : "failed",
        error: result.error,
      });
      setLocalStatus({ loading: false, error: null, signature: result.signature });
      setTimeout(() => {
        setActiveModal(null);
        setForms({
          ...forms,
          sendToken: { tokenMint: "", amount: 0, decimals: 6 },
        });
        setLocalStatus({ loading: false, error: null, signature: null });
      }, 2000);
    } else {
      setLocalStatus({ loading: false, error: result.error || "Unknown error", signature: null });
    }
  };

  const loadDistributorAssets = async () => {
     if (!publicKey) return;
     
     try {
       const rewardDistributorPda = selectedDistributor || PDAs.getRewardDistributor(publicKey)[0];
      
      // Get all token accounts owned by the distributor
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        rewardDistributorPda,
        { programId: new PublicKey("TokenkegQfeZyiNwAJsyFbPVwwQQYuU2exeJY4pocrA") }
      );

      const assetsData: DistributorAsset[] = [];

      for (const account of tokenAccounts.value) {
        const parsedData = account.account.data.parsed?.info;
        if (parsedData) {
          assetsData.push({
            type: "spl-token",
            mint: parsedData.mint,
            balance: parsedData.tokenAmount?.uiAmount || 0,
          });
        }
      }

      setAssets(assetsData);
    } catch (err) {
      console.error("Error loading assets:", err);
    }
  };

  if (!publicKey) {
    return (
      <div className="card p-8 text-center">
        <p className="text-gray-400">Connect your wallet to access token actions</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-white mb-4">Token Management</h2>

      {/* Action Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Send SPL Token */}
        <button
          onClick={() => setActiveModal("sendToken")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Send className="w-5 h-5 text-blue-400 group-hover:text-blue-300" />
          <span className="text-left">
            <div className="font-medium text-white">Send SPL Token</div>
            <div className="text-xs text-gray-400">Transfer tokens to distributor</div>
          </span>
        </button>

        {/* View Distributor Assets */}
        <button
          onClick={loadDistributorAssets}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Eye className="w-5 h-5 text-indigo-400 group-hover:text-indigo-300" />
          <span className="text-left">
            <div className="font-medium text-white">View Distributor Assets</div>
            <div className="text-xs text-gray-400">See all distributor tokens and NFTs</div>
          </span>
        </button>
      </div>

      {/* Distributor Assets Display */}
      {assets.length > 0 && (
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Distributor Assets</h3>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {assets.map((asset, idx) => (
              <div key={idx} className="bg-gray-700 p-3 rounded-lg border border-gray-600">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-white font-medium text-sm">Mint: {asset.mint.slice(0, 8)}...</p>
                    <p className="text-gray-400 text-xs mt-1">Type: {asset.type}</p>
                    {asset.balance !== undefined && (
                      <p className="text-gray-400 text-xs mt-1">Balance: {asset.balance}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        // Implementation for adding/removing from reward list
                        console.log("Toggle reward list for asset:", asset.mint);
                      }}
                      className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition"
                    >
                      {asset.isInRewardList ? "Remove" : "Add"} to Rewards
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Send Token Modal */}
      <TransactionModal
        isOpen={activeModal === "sendToken"}
        title="Send SPL Token to Distributor"
        description="Transfer SPL tokens to the reward distributor"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        onClose={() => setActiveModal(null)}
        onConfirm={handleSendToken}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Token Mint Address</label>
            <input
              type="text"
              value={forms.sendToken.tokenMint}
              onChange={(e) =>
                setForms({
                  ...forms,
                  sendToken: { ...forms.sendToken, tokenMint: e.target.value },
                })
              }
              placeholder="Enter SPL token mint address"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Amount</label>
              <input
                type="number"
                value={forms.sendToken.amount}
                onChange={(e) =>
                  setForms({
                    ...forms,
                    sendToken: { ...forms.sendToken, amount: parseFloat(e.target.value) },
                  })
                }
                placeholder="0"
                disabled={localStatus.loading}
                className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
                />
                </div>
                <div>
                <label className="block text-sm text-gray-300 mb-1">Decimals</label>
                <input
                type="number"
                value={forms.sendToken.decimals}
                onChange={(e) =>
                  setForms({
                    ...forms,
                    sendToken: { ...forms.sendToken, decimals: parseInt(e.target.value) },
                  })
                }
                disabled={localStatus.loading}
                className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
            </div>
          </div>
        </div>
      </TransactionModal>
    </div>
  );
};
