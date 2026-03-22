"use client";

import React, { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  Plus,
  Minus,
  Send,
  Lock,
  Unlock,
  Settings,
  Zap,
  List,
} from "lucide-react";
import { useTransaction } from "@/hooks/useTransaction";
import { useGlobalTransactionHistory } from "@/hooks/useGlobalTransactionHistory";
import { useRewardData } from "@/hooks/useRewardData";
import { PDAs } from "@/lib/pda";
import { TransactionModal } from "./TransactionModal";
import { CopyableAddress } from "./CopyableAddress";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

interface ActionForm {
  [key: string]: any;
}

interface AdminActionsProps {
  selectedDistributor?: PublicKey | null;
}

export const AdminActions: React.FC<AdminActionsProps> = ({ selectedDistributor }) => {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { addTransaction, updateTransaction, transactions } = useGlobalTransactionHistory();
  const {
    status,
    initializeRewardDistributor,
    setAdmins,
    setWhitelist,
    setRewardList,
    delegateRewardList,
    undelegateRewardList,
    requestRandomReward,
    addReward,
    removeReward,
  } = useTransaction({ 
    selectedDistributor,
    onTransactionAdd: addTransaction,
    onTransactionUpdate: updateTransaction,
  });

  // Use selected distributor if available, otherwise use primary (PDA-derived)
  const targetDistributor = selectedDistributor || (publicKey ? PDAs.getRewardDistributor(publicKey)[0] : null);
  const { distributor, rewardList } = useRewardData(publicKey, targetDistributor);
  
  // Log transactions for debugging
  console.log("[AdminActions] Global transactions:", transactions);

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState({
    loading: false,
    error: null as string | null,
    signature: null as string | null,
  });
  const [forms, setForms] = useState<ActionForm>({
    admins: "",
    whitelist: "",
    rewardList: {
      globalRangeMin: 0,
      globalRangeMax: 1000,
      startTimestamp: Math.floor(Date.now() / 1000),
      endTimestamp: Math.floor(Date.now() / 1000) + 86400,
    },
    randomReward: {
      user: publicKey?.toString() || "",
      clientSeed: 0,
    },
    addReward: {
      rewardName: "",
      rewardMint: "",
      rewardAmount: 1,
      drawRangeMin: 0,
      drawRangeMax: 0,
      redemptionLimit: 1,
    },
    removeReward: {
      rewardName: "",
      rewardMint: "",
      redemptionAmount: 1,
    },
  });

  // Helper to open modal with cleared status
  const openModal = (modalName: string) => {
    setLocalStatus({ loading: false, error: null, signature: null });
    setActiveModal(modalName);
  };

  // Helper to close modal with cleared status
  const closeModal = () => {
    setLocalStatus({ loading: false, error: null, signature: null });
    setActiveModal(null);
  };

  // Track localStatus changes
  useEffect(() => {
    console.log("[AdminActions] localStatus updated:", localStatus);
  }, [localStatus]);

  // Update randomReward user field when wallet changes and populate existing data
  useEffect(() => {
    setForms((prev) => {
      const updated = {
        ...prev,
        randomReward: {
          ...prev.randomReward,
          user: publicKey?.toString() || "",
        },
      };

      // Populate existing admins if available
      if (distributor?.admins && distributor.admins.length > 0) {
        updated.admins = distributor.admins
          .map((addr) => addr.toString())
          .join("\n");
      }

      // Populate existing whitelist if available
      if (distributor?.whitelist && distributor.whitelist.length > 0) {
        updated.whitelist = distributor.whitelist
          .map((addr) => addr.toString())
          .join("\n");
      }

      // Populate existing reward list parameters if available
      if (rewardList) {
        updated.rewardList = {
          globalRangeMin: rewardList.globalRangeMin || 0,
          globalRangeMax: rewardList.globalRangeMax || 1000,
          startTimestamp: rewardList.startTimestamp || Math.floor(Date.now() / 1000),
          endTimestamp: rewardList.endTimestamp || Math.floor(Date.now() / 1000) + 86400,
        };
      }

      return updated;
    });
  }, [publicKey, distributor, rewardList]);

  // Helper to handle transaction result
  const handleTransactionResult = async (
    result: any,
    actionName: string,
    onSuccess?: () => void,
    endpoint?: string
  ) => {

    if (result.signature) {
      // Get the cluster endpoint from connection
      const clusterEndpoint = endpoint || connection.rpcEndpoint || "https://api.devnet.solana.com";
      
      console.log("[handleTransactionResult] Adding transaction to history:", {
        signature: result.signature,
        actionName,
        endpoint: clusterEndpoint,
        success: result.success,
      });
      
      const txId = addTransaction(
        result.signature,
        actionName,
        "devnet",
        clusterEndpoint
      );
      
      console.log("[handleTransactionResult] Transaction added with ID:", txId);
      
      // Build error message
      let errorMessage = null;
      if (!result.success && result.error) {
        errorMessage = `Transaction failed: ${result.error}`;
        console.log("[handleTransactionResult] Error message:", errorMessage);
      }
      
      updateTransaction(txId, {
        status: result.success ? "confirmed" : "failed",
        error: result.error,
      });

      setLocalStatus({
        loading: false,
        error: errorMessage,
        signature: result.signature,
      });
      
      // Only auto-close on success
      if (result.success) {
        setTimeout(() => {
          setActiveModal(null);
          onSuccess?.();
          setLocalStatus({ loading: false, error: null, signature: null });
        }, 2000);
      }
    } else {
      setLocalStatus({
        loading: false,
        error: result.error || "Unknown error",
        signature: null,
      });
    }
  };

  const handleInitialize = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const result = await initializeRewardDistributor([]);
    await handleTransactionResult(result, "Initialize Distributor");
  };

  const handleSetAdmins = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const addresses = forms.admins.split("\n").filter((a: string) => a.trim());
    const admins = addresses.map(
      (a: string) => new PublicKey(a.trim())
    );
    const result = await setAdmins(admins);
    await handleTransactionResult(result, "Set Admins", () => {
      setForms({ ...forms, admins: "" });
    });
  };

  const handleSetWhitelist = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const addresses = forms.whitelist.split("\n").filter((a: string) => a.trim());
    const whitelist = addresses.map(
      (a: string) => new PublicKey(a.trim())
    );
    const result = await setWhitelist(whitelist);
    await handleTransactionResult(result, "Set Whitelist", () => {
      setForms({ ...forms, whitelist: "" });
    });
  };

  const handleSetRewardList = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const config = forms.rewardList;
    const result = await setRewardList(
      config.globalRangeMin,
      config.globalRangeMax,
      config.startTimestamp,
      config.endTimestamp
    );
    await handleTransactionResult(result, "Set Reward List");
  };

  const handleDelegateRewardList = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const result = await delegateRewardList();
    await handleTransactionResult(result, "Delegate Reward List");
  };

  const handleUndelegateRewardList = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const result = await undelegateRewardList();
    await handleTransactionResult(result, "Undelegate Reward List");
  };

  const handleRequestRandomReward = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const config = forms.randomReward;
    
    const result = await requestRandomReward(
      new PublicKey(config.user),
      config.clientSeed
    );
    
    if (result.signature) {
      // Get the cluster endpoint from connection
      const clusterEndpoint = connection.rpcEndpoint || "https://api.devnet.solana.com";
      
      // Add the request transaction to history
      const txId = addTransaction(
        result.signature,
        "Request Random Reward",
        "devnet",
        clusterEndpoint
      );
      
      // Update transaction to confirmed status immediately (use txId, not signature)
      updateTransaction(txId, {
        status: "confirmed",
      });
      
      setLocalStatus({
        loading: false,
        error: result.error || null,
        signature: result.signature,
      });
      
      if (result.success) {
        setTimeout(() => {
          setActiveModal(null);
          setLocalStatus({ loading: false, error: null, signature: null });
        }, 2000);
      }
    } else {
      setLocalStatus({
        loading: false,
        error: result.error || "Unknown error",
        signature: null,
      });
    }
  };

  const handleAddReward = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const config = forms.addReward;
    const rewardMint = new PublicKey(config.rewardMint)
    const tokenAccount = getAssociatedTokenAddressSync(rewardMint, new PublicKey(rewardList?.rewardDistributor!), true)
    const [metadataAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
        rewardMint.toBuffer(),
      ],
      new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
    );
    const result = await addReward(
      config.rewardName,
      rewardMint,
      tokenAccount,
      config.rewardAmount,
      config.drawRangeMin,
      config.drawRangeMax,
      config.redemptionLimit,
      metadataAccount
    );
    await handleTransactionResult(result, "Add Reward", () => {
      setForms({
        ...forms,
        addReward: {
          rewardName: "",
          rewardMint: "",
          rewardAmount: 0,
          drawRangeMin: 0,
          drawRangeMax: 0,
          redemptionLimit: 0
        },
      });
    });
  };

  const handleRemoveReward = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const config = forms.removeReward;
    const result = await removeReward(
      config.rewardName,
      config.rewardMint ? new PublicKey(config.rewardMint) : undefined,
      config.redemptionAmount
    );

    await handleTransactionResult(result, "Remove Reward", () => {
      setForms({ ...forms, removeReward: { rewardName: "", rewardMint: "", redemptionAmount: 1 } });
    });
  };

  if (!publicKey) {
    return (
      <div className="card p-8 text-center">
        <p className="text-gray-400">Connect your wallet to access admin actions</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-white mb-4">Admin Actions</h2>

      {/* Action Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Initialize Reward Distributor */}
        <button
          onClick={() => openModal("initialize")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Settings className="w-5 h-5 text-blue-400 group-hover:text-blue-300" />
          <span className="text-left">
            <div className="font-medium text-white">Initialize Distributor</div>
            <div className="text-xs text-gray-400">Create reward distributor</div>
          </span>
        </button>

        {/* Set Admins */}
        <button
          onClick={() => openModal("admins")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Lock className="w-5 h-5 text-purple-400 group-hover:text-purple-300" />
          <span className="text-left">
            <div className="font-medium text-white">Set Admins</div>
            <div className="text-xs text-gray-400">Manage admin users</div>
          </span>
        </button>

        {/* Set Whitelist */}
        <button
          onClick={() => openModal("whitelist")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Lock className="w-5 h-5 text-purple-400 group-hover:text-purple-300" />
          <span className="text-left">
            <div className="font-medium text-white">Set Whitelist</div>
            <div className="text-xs text-gray-400">Manage whitelisted users</div>
          </span>
        </button>

        {/* Set Reward List */}
        <button
          onClick={() => setActiveModal("rewardList")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <List className="w-5 h-5 text-green-400 group-hover:text-green-300" />
          <span className="text-left">
            <div className="font-medium text-white">Set Reward List</div>
            <div className="text-xs text-gray-400">Configure reward parameters</div>
          </span>
        </button>

        {/* Delegate Reward List */}
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

        {/* Undelegate Reward List */}
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

        {/* Request Random Reward */}
        <button
          onClick={() => setActiveModal("randomReward")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Zap className="w-5 h-5 text-yellow-400 group-hover:text-yellow-300" />
          <span className="text-left">
            <div className="font-medium text-white">Request Random Reward</div>
            <div className="text-xs text-gray-400">Trigger VRF callback</div>
          </span>
        </button>

        {/* Add Reward */}
        <button
          onClick={() => setActiveModal("addReward")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Plus className="w-5 h-5 text-emerald-400 group-hover:text-emerald-300" />
          <span className="text-left">
            <div className="font-medium text-white">Add Reward</div>
            <div className="text-xs text-gray-400">Add new reward to list</div>
          </span>
        </button>

        {/* Remove Reward */}
        <button
          onClick={() => setActiveModal("removeReward")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Minus className="w-5 h-5 text-red-400 group-hover:text-red-300" />
          <span className="text-left">
            <div className="font-medium text-white">Remove Reward</div>
            <div className="text-xs text-gray-400">Remove reward from list</div>
          </span>
        </button>
      </div>

      {/* Initialize Modal */}
      <TransactionModal
        isOpen={activeModal === "initialize"}
        title="Initialize Reward Distributor"
        description="Create a new reward distributor account"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={connection.rpcEndpoint}
                endpoint={connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleInitialize}
      />

      {/* Set Admins Modal */}
      <TransactionModal
        isOpen={activeModal === "admins"}
        title="Set Admins"
        description="Manage admin users for this distributor"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleSetAdmins}
      >
        <div className="space-y-3">
          {/* Current Admins Info */}
          {distributor?.admins && distributor.admins.length > 0 && (
            <div className="bg-blue-900 bg-opacity-30 border border-blue-700 p-3 rounded text-sm">
              <p className="text-blue-300 font-semibold mb-2">Current Admins ({distributor.admins.length} addresses)</p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {distributor.admins.map((addr, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <CopyableAddress address={addr.toString()} />
                    {idx === 0 && <span className="text-xs text-gray-400">(super_admin)</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Admins Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              Admin Addresses
            </label>
            <textarea
              value={forms.admins}
              onChange={(e) => setForms({ ...forms, admins: e.target.value })}
              placeholder="Enter wallet addresses (one per line)"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 font-mono text-sm"
              rows={6}
            />
            <p className="text-xs text-gray-400 mt-2">
              📝 {forms.admins.split('\n').filter(a => a.trim()).length} address(es) to be set
            </p>
          </div>

          {/* Helper Text */}
          <div className="bg-gray-800 p-2 rounded text-xs text-gray-400">
            💡 Super admin is automatically included. Duplicates will be removed.
          </div>
        </div>
      </TransactionModal>

      {/* Set Whitelist Modal */}
      <TransactionModal
        isOpen={activeModal === "whitelist"}
        title="Set Whitelist"
        description="Manage wallet addresses that are whitelisted for this distributor"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleSetWhitelist}
      >
        <div className="space-y-3">
          {/* Current Whitelist Info */}
          {distributor?.whitelist && distributor.whitelist.length > 0 && (
            <div className="bg-blue-900 bg-opacity-30 border border-blue-700 p-3 rounded text-sm">
              <p className="text-blue-300 font-semibold mb-2">Current Whitelist ({distributor.whitelist.length} addresses)</p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {distributor.whitelist.map((addr, idx) => (
                  <CopyableAddress key={idx} address={addr.toString()} />
                ))}
              </div>
            </div>
          )}

          {/* Whitelist Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              Whitelist Addresses
            </label>
            <textarea
              value={forms.whitelist}
              onChange={(e) => setForms({ ...forms, whitelist: e.target.value })}
              placeholder="Enter wallet addresses (one per line)"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 font-mono text-sm"
              rows={6}
            />
            <p className="text-xs text-gray-400 mt-2">
              📝 {forms.whitelist.split('\n').filter(a => a.trim()).length} address(es) to be set
            </p>
          </div>

          {/* Helper Text */}
          <div className="bg-gray-800 p-2 rounded text-xs text-gray-400">
            <p>💡 Enter one wallet address per line. Leave empty to clear the whitelist.</p>
          </div>
        </div>
      </TransactionModal>

      {/* Set Reward List Modal */}
      <TransactionModal
       isOpen={activeModal === "rewardList"}
       title="Set Reward List Parameters"
       description="Configure the reward list parameters"
       loading={localStatus.loading}
       error={localStatus.error}
       signature={localStatus.signature}
               endpoint={connection.rpcEndpoint}
        onClose={closeModal}
       onConfirm={handleSetRewardList}
      >
       <div className="space-y-3 max-h-96 overflow-y-auto">
         <div className="grid grid-cols-2 gap-2">
           <div>
             <label className="block text-sm text-gray-300 mb-1">Global Range Min</label>
             <input
               type="number"
               value={forms.rewardList.globalRangeMin}
               onChange={(e) =>
                 setForms({
                   ...forms,
                   rewardList: {
                     ...forms.rewardList,
                     globalRangeMin: parseInt(e.target.value),
                   },
                 })
               }
               disabled={localStatus.loading}
               className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
             />
           </div>
           <div>
             <label className="block text-sm text-gray-300 mb-1">Global Range Max</label>
             <input
               type="number"
               value={forms.rewardList.globalRangeMax}
               onChange={(e) =>
                 setForms({
                   ...forms,
                   rewardList: {
                     ...forms.rewardList,
                     globalRangeMax: parseInt(e.target.value),
                   },
                 })
               }
               disabled={localStatus.loading}
               className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
             />
           </div>
         </div>

         <div>
           <label className="block text-sm text-gray-300 mb-1">Start Date & Time</label>
           <input
             type="datetime-local"
             value={new Date(Number(forms.rewardList.startTimestamp) * 1000).toISOString().slice(0, 16)}
             onChange={(e) => {
               const date = new Date(e.target.value);
               const timestamp = Math.floor(date.getTime() / 1000);
               setForms({
                 ...forms,
                 rewardList: {
                   ...forms.rewardList,
                   startTimestamp: timestamp,
                 },
               });
             }}
             disabled={localStatus.loading}
             className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
           />
           <p className="text-xs text-gray-500 mt-1">
             Unix Timestamp: {forms.rewardList.startTimestamp}
           </p>
         </div>

         <div>
           <label className="block text-sm text-gray-300 mb-1">End Date & Time</label>
           <input
             type="datetime-local"
             value={new Date(Number(forms.rewardList.endTimestamp) * 1000).toISOString().slice(0, 16)}
             onChange={(e) => {
               const date = new Date(e.target.value);
               const timestamp = Math.floor(date.getTime() / 1000);
               setForms({
                 ...forms,
                 rewardList: {
                   ...forms.rewardList,
                   endTimestamp: timestamp,
                 },
               });
             }}
             disabled={localStatus.loading}
             className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
           />
           <p className="text-xs text-gray-500 mt-1">
             Unix Timestamp: {forms.rewardList.endTimestamp}
           </p>
         </div>

           {/* Existing Rewards Display */}
           {rewardList && rewardList.rewards && rewardList.rewards.length > 0 && (
             <div className="border-t border-gray-600 pt-3">
               <label className="block text-sm font-medium text-gray-300 mb-2">Current Rewards in Listaaaaa</label>
               <div className="space-y-2 max-h-80 overflow-y-auto">
                 {rewardList.rewards.map((reward, idx) => (
                   <details
                     key={idx}
                     className="bg-gray-800 p-3 rounded border border-gray-700 text-xs group"
                   >
                     <summary className="cursor-pointer font-medium text-white hover:text-indigo-300 transition flex-1">
                       <span className="text-lg font-bold">{reward.name || reward.rewardName || "Unknown"}</span> 
                       <span className="text-gray-400 text-sm ml-2">({reward.rewardAmount?.toString() || "0"})</span>
                     </summary>
                     <div className="mt-3 space-y-2 pl-2 border-l border-gray-600">
                       <div>
                         <span className="text-gray-400 font-semibold">Reward Name:</span>
                         <span className="text-white ml-2 text-base font-bold">{reward.name || reward.rewardName || "N/A"}</span>
                       </div>
                       <div>
                         <span className="text-gray-400">Reward Amount:</span>
                         <span className="text-white ml-2">{reward.rewardAmount?.toString() || "0"}</span>
                       </div>
                       <div>
                         <span className="text-gray-400">Draw Range Min:</span>
                         <span className="text-white ml-2">{reward.drawRangeMin?.toString() || "0"}</span>
                       </div>
                       <div>
                         <span className="text-gray-400">Draw Range Max:</span>
                         <span className="text-white ml-2">{reward.drawRangeMax?.toString() || "0"}</span>
                       </div>
                       <div>
                         <span className="text-gray-400">Redemption Limit:</span>
                         <span className="text-white ml-2">{reward.redemptionLimit?.toString() || "0"}</span>
                       </div>
                       {reward.tokenAccount && (
                         <div>
                           <span className="text-gray-400">Token Account:</span>
                           <div className="text-gray-300 break-all mt-1">{reward.tokenAccount.toString()}</div>
                         </div>
                       )}
                       {reward.rewardMints[0] && (
                         <div>
                           <span className="text-gray-400">Mint:</span>
                           <div className="text-gray-300 break-all mt-1">{reward.rewardMints[0].toString()}</div>
                         </div>
                       )}
                       {reward.rewardType && (
                         <div>
                           <span className="text-gray-400">Reward Type:</span>
                           <span className="text-white ml-2">{typeof reward.rewardType === 'object' ? JSON.stringify(reward.rewardType) : reward.rewardType}</span>
                         </div>
                       )}
                       {reward.redemptionCount !== undefined && (
                         <div>
                           <span className="text-gray-400">Redemption Count:</span>
                           <span className="text-white ml-2">{reward.redemptionCount?.toString() || "0"}</span>
                         </div>
                       )}
                     </div>
                   </details>
                 ))}
               </div>
               <p className="text-xs text-gray-400 mt-3 bg-gray-900 p-2 rounded">
                 💡 To modify rewards, use the "Add Reward" action to update parameters or "Remove Reward" to delete. Rewards are part of the reward list and managed separately from these parameters.
               </p>
             </div>
           )}
           </div>
           </TransactionModal>

      {/* Delegate Modal */}
      <TransactionModal
        isOpen={activeModal === "delegate"}
        title="Delegate Reward List"
        description="Deploy reward list to Ephemeral Rollup"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
                endpoint={connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleDelegateRewardList}
      />

      {/* Undelegate Modal */}
      <TransactionModal
        isOpen={activeModal === "undelegate"}
        title="Undelegate Reward List"
        description="Withdraw reward list from Ephemeral Rollup"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
                endpoint={connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleUndelegateRewardList}
      />

      {/* Request Random Reward Modal */}
      <TransactionModal
        isOpen={activeModal === "randomReward"}
        title="Request Random Reward"
        description="Request a random reward for a user"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
                endpoint={connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleRequestRandomReward}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1">User Address</label>
            <input
              type="text"
              value={forms.randomReward.user}
              onChange={(e) =>
                setForms({
                  ...forms,
                  randomReward: {
                    ...forms.randomReward,
                    user: e.target.value,
                  },
                })
              }
              placeholder="Enter user's wallet address"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
              </div>
              <div>
              <label className="block text-sm text-gray-300 mb-1">Client Seed</label>
              <input
              type="number"
              value={forms.randomReward.clientSeed}
              onChange={(e) =>
                setForms({
                  ...forms,
                  randomReward: {
                    ...forms.randomReward,
                    clientSeed: parseInt(e.target.value),
                  },
                })
              }
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
              </div>
              </div>
              </TransactionModal>

              {/* Add Reward Modal */}
              <TransactionModal
              isOpen={activeModal === "addReward"}
              title="Add Reward"
              description="Add a new reward to the reward list"
              loading={localStatus.loading}
              error={localStatus.error}
              signature={localStatus.signature}
                endpoint={connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleAddReward}
      >
        <div className="space-y-3 max-h-96 overflow-y-auto">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Reward Name</label>
            <input
              type="text"
              value={forms.addReward.rewardName}
              onChange={(e) =>
                setForms({
                  ...forms,
                  addReward: { ...forms.addReward, rewardName: e.target.value },
                })
              }
              placeholder="e.g., Gold Prize"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
              </div>
              <div>
              <label className="block text-sm text-gray-300 mb-1">Mint Address</label>
              <input
              type="text"
              value={forms.addReward.rewardMint}
              onChange={(e) =>
                setForms({
                  ...forms,
                  addReward: { ...forms.addReward, rewardMint: e.target.value },
                })
              }
              placeholder="Enter mint address"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
              </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Amount</label>
              <input
                type="number"
                value={forms.addReward.rewardAmount}
                onChange={(e) =>
                  setForms({
                    ...forms,
                    addReward: {
                      ...forms.addReward,
                      rewardAmount: parseInt(e.target.value),
                    },
                  })
                }
                disabled={localStatus.loading}
                className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
                />
                </div>
                <div>
                <label className="block text-sm text-gray-300 mb-1">Redemption Limit</label>
                <input
                type="number"
                value={forms.addReward.redemptionLimit}
                onChange={(e) =>
                  setForms({
                    ...forms,
                    addReward: {
                      ...forms.addReward,
                      redemptionLimit: parseInt(e.target.value),
                    },
                  })
                }
                disabled={localStatus.loading}
                className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
                />
                </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                <div>
                <label className="block text-sm text-gray-300 mb-1">Range Min</label>
                <input
                type="number"
                value={forms.addReward.drawRangeMin}
                onChange={(e) =>
                  setForms({
                    ...forms,
                    addReward: {
                      ...forms.addReward,
                      drawRangeMin: parseInt(e.target.value),
                    },
                  })
                }
                disabled={localStatus.loading}
                className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
                />
                </div>
                <div>
                <label className="block text-sm text-gray-300 mb-1">Range Max</label>
                <input
                type="number"
                value={forms.addReward.drawRangeMax}
                onChange={(e) =>
                  setForms({
                    ...forms,
                    addReward: {
                      ...forms.addReward,
                      drawRangeMax: parseInt(e.target.value),
                    },
                  })
                }
                disabled={localStatus.loading}
                className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
            </div>
          </div>
        </div>
      </TransactionModal>

      {/* Remove Reward Modal */}
      <TransactionModal
        isOpen={activeModal === "removeReward"}
        title="Remove Reward"
        description="Select a reward to remove from the reward list"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
                endpoint={connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleRemoveReward}
      >
        <div className="space-y-3">
          {/* Available Rewards Dropdown */}
          {rewardList && rewardList.rewards && rewardList.rewards.length > 0 && (
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Select Reward to Remove</label>
              <select
                value={forms.removeReward.rewardName}
                onChange={(e) => {
                  const reward = rewardList.rewards?.find(r => r.name === e.target.value || r.rewardName === e.target.value);
                  setForms({
                    ...forms,
                    removeReward: {
                      rewardName: e.target.value,
                      rewardMint: reward?.rewardMints[0]?.toString() || "",
                      redemptionAmount: reward?.redemptionLimit ? Number(reward.redemptionLimit - reward.redemptionCount) : 0,
                    },
                  });
                }}
                disabled={localStatus.loading}
                className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              >
                <option value="">-- Select a reward --</option>
                {rewardList.rewards.map((reward, idx) => (
                  <option key={idx} value={reward.name || reward.rewardName}>
                    {reward.name || reward.rewardName} ({(reward.redemptionLimit - reward.redemptionCount)?.toString() || "0"})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">Reward Name</label>
            <input
              type="text"
              value={forms.removeReward.rewardName}
              onChange={(e) =>
                setForms({
                  ...forms,
                  removeReward: { ...forms.removeReward, rewardName: e.target.value },
                })
              }
              placeholder="Reward name"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">Mint Address</label>
            <input
              type="text"
              value={forms.removeReward.rewardMint}
              onChange={(e) =>
                setForms({
                  ...forms,
                  removeReward: { ...forms.removeReward, rewardMint: e.target.value },
                })
              }
              placeholder="Mint address (optional)"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm font-mono text-xs"
            />
            {forms.removeReward.rewardMint && (
              <p className="text-xs text-gray-400 mt-1">Mint: {forms.removeReward.rewardMint}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">Redemption Amount</label>
            <input
              type="number"
              value={forms.removeReward.redemptionAmount}
              onChange={(e) =>
                setForms({
                  ...forms,
                  removeReward: { ...forms.removeReward, redemptionAmount: parseInt(e.target.value) || 0 },
                })
              }
              placeholder="0"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">Amount to redeem from the reward</p>
          </div>

          <div className="bg-gray-800 p-2 rounded text-xs text-gray-400">
            💡 Select from the dropdown or enter the reward name, mint address, and redemption amount manually
          </div>
        </div>
      </TransactionModal>
    </div>
  );
};
