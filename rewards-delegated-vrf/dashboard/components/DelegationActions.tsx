"use client";

import React, { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Send, Unlock } from "lucide-react";
import { useTransaction } from "@/hooks/useTransaction";
import { useGlobalTransactionHistory } from "@/hooks/useGlobalTransactionHistory";
import { getDefaultSolanaEndpoint } from "@/lib/clusterContext";
import { requestDashboardDataRefresh } from "@/lib/refresh";
import { TransactionModal } from "./TransactionModal";

interface DelegationActionsProps {
  selectedDistributor?: PublicKey | null;
}

export const DelegationActions: React.FC<DelegationActionsProps> = ({
  selectedDistributor,
}) => {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { addTransaction, updateTransaction } = useGlobalTransactionHistory();
  const { delegateRewardList, undelegateRewardList } = useTransaction({
    selectedDistributor,
    onTransactionAdd: addTransaction,
    onTransactionUpdate: updateTransaction,
  });

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState({
    loading: false,
    error: null as string | null,
    signature: null as string | null,
    endpoint: null as string | null,
  });

  const closeModal = () => {
    setLocalStatus({ loading: false, error: null, signature: null, endpoint: null });
    setActiveModal(null);
  };

  const handleTransactionResult = (result: any, actionName: string) => {
    if (result.signature) {
      const clusterEndpoint =
        result.endpoint || connection.rpcEndpoint || getDefaultSolanaEndpoint();
      const txId = addTransaction(
        result.signature,
        actionName,
        "devnet",
        clusterEndpoint
      );

      updateTransaction(txId, {
        status: result.success ? "confirmed" : "failed",
        error: result.error,
      });

      setLocalStatus({
        loading: false,
        error: result.success ? null : result.error || "Unknown error",
        signature: result.signature,
        endpoint: clusterEndpoint,
      });

      if (result.success) {
        requestDashboardDataRefresh();
        setTimeout(() => {
          closeModal();
        }, 2000);
      }
      return;
    }

    setLocalStatus({
      loading: false,
      error: result.error || "Unknown error",
      signature: null,
      endpoint: result.endpoint || null,
    });
  };

  const handleDelegate = async () => {
    setLocalStatus({ loading: true, error: null, signature: null, endpoint: null });
    const result = await delegateRewardList();
    handleTransactionResult(result, "Delegate Reward List");
  };

  const handleUndelegate = async () => {
    setLocalStatus({ loading: true, error: null, signature: null, endpoint: null });
    const result = await undelegateRewardList();
    handleTransactionResult(result, "Undelegate Reward List");
  };

  if (!publicKey) {
    return (
      <div className="card p-8 text-center">
        <p className="text-gray-400">Connect your wallet to access delegation actions</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-white mb-4">Reward List Delegation</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button
          onClick={() => setActiveModal("delegate")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Send className="w-5 h-5 text-orange-400 group-hover:text-orange-300" />
          <span className="text-left">
            <div className="font-medium text-white">Delegate Reward List</div>
            <div className="text-xs text-gray-400">Deploy to Ephemeral Rollup</div>
          </span>
        </button>

        <button
          onClick={() => setActiveModal("undelegate")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Unlock className="w-5 h-5 text-red-400 group-hover:text-red-300" />
          <span className="text-left">
            <div className="font-medium text-white">Undelegate Reward List</div>
            <div className="text-xs text-gray-400">Withdraw from Ephemeral Rollup</div>
          </span>
        </button>
      </div>

      <TransactionModal
        isOpen={activeModal === "delegate"}
        title="Delegate Reward List"
        description="Deploy reward list to Ephemeral Rollup"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={localStatus.endpoint || connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleDelegate}
      />

      <TransactionModal
        isOpen={activeModal === "undelegate"}
        title="Undelegate Reward List"
        description="Withdraw reward list from Ephemeral Rollup"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={localStatus.endpoint || connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleUndelegate}
      />
    </div>
  );
};
