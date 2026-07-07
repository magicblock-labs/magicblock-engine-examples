"use client";

import React, { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Send, Unlock, ChevronDown } from "lucide-react";
import { useTransaction } from "@/hooks/useTransaction";
import { useGlobalTransactionHistory } from "@/hooks/useGlobalTransactionHistory";
import { getDefaultSolanaEndpoint } from "@/lib/clusterContext";
import { requestDashboardDataRefresh } from "@/lib/refresh";
import { TransactionModal } from "./TransactionModal";

interface MagicBlockValidator {
  name: string;
  validator: PublicKey;
  network: "devnet" | "mainnet";
}

const MAGICBLOCK_VALIDATORS: MagicBlockValidator[] = [
  {
    name: "MagicBlock Devnet Asia",
    validator: new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"),
    network: "devnet",
  },
  {
    name: "MagicBlock Devnet US",
    validator: new PublicKey("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd"),
    network: "devnet",
  },
  {
    name: "MagicBlock Mainnet Asia",
    validator: new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"),
    network: "mainnet",
  },
  {
    name: "MagicBlock Mainnet US",
    validator: new PublicKey("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd"),
    network: "mainnet",
  },
];

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
  const [selectedValidator, setSelectedValidator] = useState<MagicBlockValidator>(MAGICBLOCK_VALIDATORS[0]);
  const [validatorDropdownOpen, setValidatorDropdownOpen] = useState(false);
  const [localStatus, setLocalStatus] = useState({
    loading: false,
    error: null as string | null,
    signature: null as string | null,
    endpoint: null as string | null,
  });

  const closeModal = () => {
    setLocalStatus({ loading: false, error: null, signature: null, endpoint: null });
    setActiveModal(null);
    setValidatorDropdownOpen(false);
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
      endpoint: ('endpoint' in result ? result.endpoint : null) || null,
    });
  };

  const handleDelegate = async () => {
    setLocalStatus({ loading: true, error: null, signature: null, endpoint: null });
    const result = await delegateRewardList(selectedValidator.validator);
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
      >
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">
            MagicBlock Validator
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setValidatorDropdownOpen(!validatorDropdownOpen)}
              className="w-full flex items-center justify-between px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm hover:bg-gray-600 transition"
            >
              <div className="text-left">
                <div className="font-medium">{selectedValidator.name}</div>
                <div className="text-xs text-gray-400 font-mono">
                  {selectedValidator.validator.toBase58().slice(0, 8)}...
                  <span className="ml-2 text-gray-500">
                    ({selectedValidator.network})
                  </span>
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 transition-transform ${
                  validatorDropdownOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {validatorDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded shadow-lg z-50 overflow-hidden">
                {MAGICBLOCK_VALIDATORS.map((v) => (
                  <button
                    key={`${v.name}`}
                    type="button"
                    onClick={() => {
                      setSelectedValidator(v);
                      setValidatorDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-600 transition ${
                      selectedValidator.name === v.name
                        ? "bg-blue-600/20 text-white"
                        : "text-gray-300"
                    }`}
                  >
                    <div className="font-medium">{v.name}</div>
                    <div className="text-xs text-gray-400 font-mono">
                      {v.validator.toBase58().slice(0, 8)}...
                      <span className="ml-2 text-gray-500">
                        → Solana {v.network === "devnet" ? "Devnet" : "Mainnet"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Transaction will be submitted to Solana{" "}
            {selectedValidator.network === "devnet" ? "Devnet" : "Mainnet"}
          </p>
        </div>
      </TransactionModal>

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
