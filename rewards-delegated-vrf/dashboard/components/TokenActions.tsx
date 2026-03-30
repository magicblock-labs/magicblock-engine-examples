"use client";

import React, { useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Send } from "lucide-react";
import { useTransaction } from "@/hooks/useTransaction";
import { useGlobalTransactionHistory } from "@/hooks/useGlobalTransactionHistory";
import { getDefaultSolanaEndpoint } from "@/lib/clusterContext";
import { requestDashboardDataRefresh } from "@/lib/refresh";
import { shortAddress } from "@/lib/utils";
import {
  fetchOwnedSplMintOptions,
  type OwnedSplMintOption,
} from "@/lib/tokenAccounts";
import { TransactionModal } from "./TransactionModal";

interface ActionForm {
  [key: string]: any;
}

interface TokenActionsProps {
  selectedDistributor?: PublicKey | null;
  showTitle?: boolean;
}

export const TokenActions: React.FC<TokenActionsProps> = ({
  selectedDistributor,
  showTitle = true,
}) => {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { sendSplTokenToDistributor } = useTransaction({ selectedDistributor });
  const { addTransaction, updateTransaction } = useGlobalTransactionHistory();

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState({
    loading: false,
    error: null as string | null,
    signature: null as string | null,
  });
  const [forms, setForms] = useState<ActionForm>({
    sendToken: {
      tokenMint: "",
      amount: 0,
    },
  });
  const [availableWalletMints, setAvailableWalletMints] = useState<OwnedSplMintOption[]>([]);
  const [loadingWalletMints, setLoadingWalletMints] = useState(false);
  const [walletMintFetchError, setWalletMintFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadWalletMints = async () => {
      if (activeModal !== "sendToken" || !publicKey) {
        if (!cancelled) {
          setAvailableWalletMints([]);
          setLoadingWalletMints(false);
          setWalletMintFetchError(null);
        }
        return;
      }

      setLoadingWalletMints(true);
      setWalletMintFetchError(null);

      try {
        const mintFetchResult = await fetchOwnedSplMintOptions(
          connection,
          publicKey
        );
        if (!cancelled) {
          setAvailableWalletMints(mintFetchResult.options);
        }
      } catch (error) {
        console.error("[TokenActions] Failed to load wallet token mints:", error);
        if (!cancelled) {
          setAvailableWalletMints([]);
          setWalletMintFetchError(error instanceof Error ? error.message : "Unknown fetch error");
        }
      } finally {
        if (!cancelled) {
          setLoadingWalletMints(false);
        }
      }
    };

    void loadWalletMints();

    return () => {
      cancelled = true;
    };
  }, [activeModal, connection.rpcEndpoint, publicKey]);

  const handleSendToken = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const config = forms.sendToken;
    const selectedMintOption = availableWalletMints.find(
      (option) => option.mint === config.tokenMint
    );
    const result = await sendSplTokenToDistributor(
      new PublicKey(config.tokenMint),
      config.amount,
      selectedMintOption?.decimals ?? 0
    );
    
    if (result.signature) {
      const txId = addTransaction(
        result.signature,
        "Send SPL Token to Distributor",
        "devnet",
        result.endpoint || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || getDefaultSolanaEndpoint()
      );
      updateTransaction(txId, {
        status: result.success ? "confirmed" : "failed",
        error: result.error,
      });
      if (result.success) {
        requestDashboardDataRefresh();
      }
      setLocalStatus({ loading: false, error: null, signature: result.signature });
      setTimeout(() => {
        setActiveModal(null);
        setForms({
          ...forms,
          sendToken: { tokenMint: "", amount: 0 },
        });
        setLocalStatus({ loading: false, error: null, signature: null });
      }, 2000);
    } else {
      setLocalStatus({ loading: false, error: result.error || "Unknown error", signature: null });
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
      {showTitle && <h2 className="text-2xl font-bold text-white mb-4">Token Management</h2>}

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
      </div>

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
            <label className="block text-sm text-gray-300 mb-1">Token Mint</label>
            {walletMintFetchError && (
              <div className="mt-2 rounded border border-red-700 bg-red-900/20 p-2 text-xs text-red-300">
                Fetch error: {walletMintFetchError}
              </div>
            )}
            <select
              value={forms.sendToken.tokenMint}
              onChange={(e) =>
                setForms({
                  ...forms,
                  sendToken: {
                    ...forms.sendToken,
                    tokenMint: e.target.value,
                  },
                })
              }
              disabled={localStatus.loading || loadingWalletMints || availableWalletMints.length === 0}
              className="mt-2 w-full rounded border border-gray-600 bg-gray-700 p-2 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">
                {availableWalletMints.length > 0 ? "Select wallet mint" : "No wallet token accounts found"}
              </option>
              {availableWalletMints.map((option) => (
                <option key={option.tokenAccount} value={option.mint}>
                  {shortAddress(option.mint, 5)} ({option.balanceLabel})
                </option>
              ))}
            </select>
          </div>
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
        </div>
      </TransactionModal>
    </div>
  );
};
