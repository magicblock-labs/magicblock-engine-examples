"use client";

import React, { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  Plus,
  Minus,
  Lock,
  Settings,
  Zap,
  List,
} from "lucide-react";
import { useTransaction } from "@/hooks/useTransaction";
import { useGlobalTransactionHistory } from "@/hooks/useGlobalTransactionHistory";
import { useRewardData } from "@/hooks/useRewardData";
import { PDAs } from "@/lib/pda";
import { getDefaultSolanaEndpoint } from "@/lib/clusterContext";
import {
  fetchOwnedSplMintOptions,
  type OwnedSplMintOption,
} from "@/lib/tokenAccounts";
import { TransactionModal } from "./TransactionModal";
import { CopyableAddress } from "./CopyableAddress";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { requestDashboardDataRefresh } from "@/lib/refresh";
import { shortAddress } from "@/lib/utils";

interface ActionForm {
  [key: string]: any;
}

interface AdminActionsProps {
  selectedDistributor?: PublicKey | null;
}

export const AdminActions: React.FC<AdminActionsProps> = ({ selectedDistributor }) => {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { addTransaction, updateTransaction } = useGlobalTransactionHistory();
  const {
    initializeRewardDistributor,
    setAdmins,
    setWhitelist,
    setRewardList,
    requestRandomReward,
    addReward,
    removeReward,
    updateReward,
  } = useTransaction({ 
    selectedDistributor,
    onTransactionAdd: addTransaction,
    onTransactionUpdate: updateTransaction,
  });

  // Use selected distributor if available, otherwise use primary (PDA-derived)
  const targetDistributor = selectedDistributor || (publicKey ? PDAs.getRewardDistributor(publicKey)[0] : null);
  const targetDistributorKey = targetDistributor?.toBase58() ?? null;
  const { distributor, rewardList } = useRewardData(publicKey, targetDistributor);

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState({
    loading: false,
    error: null as string | null,
    signature: null as string | null,
    endpoint: null as string | null,
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
    updateReward: {
      currentRewardName: "",
      rewardName: "",
      rewardMint: "",
      rewardAmount: 1,
      drawRangeMin: 0,
      drawRangeMax: 0,
    },
  });
  const [availableDistributorMints, setAvailableDistributorMints] = useState<OwnedSplMintOption[]>([]);
  const [loadingDistributorMints, setLoadingDistributorMints] = useState(false);
  const [distributorMintFetchError, setDistributorMintFetchError] = useState<string | null>(null);
  const availableRewardNames = Array.from(
    new Set(
      (rewardList?.rewards ?? [])
        .map((reward: any) => reward.name || reward.rewardName)
        .filter((name: string | undefined): name is string => Boolean(name))
    )
  ).sort((left, right) => left.localeCompare(right));
  const rewardRangeSummary = [...(rewardList?.rewards ?? [])]
    .map((reward: any) => ({
      name: reward.name || reward.rewardName || "Unnamed Reward",
      drawRangeMin: reward.drawRangeMin,
      drawRangeMax: reward.drawRangeMax,
    }))
    .sort((left, right) => {
      if (left.drawRangeMin !== right.drawRangeMin) {
        return left.drawRangeMin - right.drawRangeMin;
      }
      return left.name.localeCompare(right.name);
    });
  const selectedRewardForRemoval = (rewardList?.rewards ?? []).find(
    (reward: any) =>
      reward.name === forms.removeReward.rewardName ||
      reward.rewardName === forms.removeReward.rewardName
  );
  const availableRewardRemovalMints = Array.from(
    new Set(
      (selectedRewardForRemoval?.rewardMints ?? [])
        .map((mint: any) => mint?.toString?.())
        .filter((mint: string | undefined): mint is string => Boolean(mint))
    )
  ).sort((left, right) => left.localeCompare(right));
  const selectedAddRewardMintOption = availableDistributorMints.find(
    (option) => option.mint === forms.addReward.rewardMint
  );
  const selectedExistingAddReward = (rewardList?.rewards ?? []).find(
    (reward: any) =>
      reward.name === forms.addReward.rewardName ||
      reward.rewardName === forms.addReward.rewardName
  );
  const selectedExistingAddRewardType = selectedExistingAddReward?.rewardType
    ? Object.keys(selectedExistingAddReward.rewardType)[0]
    : null;
  const isSelectedAddRewardNft =
    selectedExistingAddRewardType === "legacyNft" ||
    selectedExistingAddRewardType === "programmableNft" ||
    (selectedExistingAddRewardType == null && selectedAddRewardMintOption?.isNftLike === true);
  const shouldHideAddRewardAmount = Boolean(selectedExistingAddReward) || isSelectedAddRewardNft;
  const shouldHideAddRewardRedemptionIncrease = isSelectedAddRewardNft;
  const selectedRewardForUpdate = (rewardList?.rewards ?? []).find(
    (reward: any) =>
      reward.name === forms.updateReward.currentRewardName ||
      reward.rewardName === forms.updateReward.currentRewardName
  );
  const selectedUpdateRewardType = selectedRewardForUpdate?.rewardType
    ? Object.keys(selectedRewardForUpdate.rewardType)[0]
    : null;
  const isSelectedUpdateRewardNft =
    selectedUpdateRewardType === "legacyNft" ||
    selectedUpdateRewardType === "programmableNft";
  const selectedUpdateRewardTypeLabel =
    selectedUpdateRewardType === "legacyNft"
      ? "Legacy NFT"
      : selectedUpdateRewardType === "programmableNft"
        ? "Programmable NFT"
        : selectedUpdateRewardType === "splToken2022"
          ? "SPL Token 2022"
          : selectedUpdateRewardType === "splToken"
            ? "SPL Token"
            : selectedUpdateRewardType ?? "";

  useEffect(() => {
    if (!selectedRewardForUpdate) {
      return;
    }

    setForms((prev) => {
      const nextUpdateReward = {
        currentRewardName: prev.updateReward.currentRewardName,
        rewardName: selectedRewardForUpdate.name,
        rewardMint: selectedRewardForUpdate.rewardMints?.[0]?.toString?.() || "",
        rewardAmount: selectedRewardForUpdate.rewardAmount ?? 1,
        drawRangeMin: selectedRewardForUpdate.drawRangeMin ?? 0,
        drawRangeMax: selectedRewardForUpdate.drawRangeMax ?? 0,
      };

      const unchanged =
        prev.updateReward.currentRewardName === nextUpdateReward.currentRewardName &&
        prev.updateReward.rewardName === nextUpdateReward.rewardName &&
        prev.updateReward.rewardMint === nextUpdateReward.rewardMint &&
        prev.updateReward.rewardAmount === nextUpdateReward.rewardAmount &&
        prev.updateReward.drawRangeMin === nextUpdateReward.drawRangeMin &&
        prev.updateReward.drawRangeMax === nextUpdateReward.drawRangeMax;

      if (unchanged) {
        return prev;
      }

      return {
        ...prev,
        updateReward: nextUpdateReward,
      };
    });
  }, [selectedRewardForUpdate]);

  useEffect(() => {
    if (
      activeModal !== "updateReward" ||
      forms.updateReward.currentRewardName ||
      availableRewardNames.length === 0
    ) {
      return;
    }

    const defaultRewardName = availableRewardNames[0];
    const defaultReward = (rewardList?.rewards ?? []).find(
      (reward: any) =>
        reward.name === defaultRewardName || reward.rewardName === defaultRewardName
    );

    setForms((prev) => ({
      ...prev,
      updateReward: {
        currentRewardName: defaultRewardName,
        rewardName: defaultReward?.name || defaultRewardName,
        rewardMint: defaultReward?.rewardMints?.[0]?.toString?.() || "",
        rewardAmount: defaultReward?.rewardAmount ?? 1,
        drawRangeMin: defaultReward?.drawRangeMin ?? 0,
        drawRangeMax: defaultReward?.drawRangeMax ?? 0,
      },
    }));
  }, [activeModal, availableRewardNames, forms.updateReward.currentRewardName, rewardList]);

  useEffect(() => {
    if (
      activeModal !== "removeReward" ||
      forms.removeReward.rewardName ||
      availableRewardNames.length === 0
    ) {
      return;
    }

    const defaultRewardName = availableRewardNames[0];
    const defaultReward = (rewardList?.rewards ?? []).find(
      (reward: any) =>
        reward.name === defaultRewardName || reward.rewardName === defaultRewardName
    );

    setForms((prev) => ({
      ...prev,
      removeReward: {
        rewardName: defaultRewardName,
        rewardMint: defaultReward?.rewardMints?.[0]?.toString?.() || "",
        redemptionAmount: 1,
      },
    }));
  }, [activeModal, availableRewardNames, forms.removeReward.rewardName, rewardList]);

  // Helper to open modal with cleared status
  const openModal = (modalName: string) => {
    setLocalStatus({ loading: false, error: null, signature: null, endpoint: null });
    setActiveModal(modalName);
  };

  // Helper to close modal with cleared status
  const closeModal = () => {
    setLocalStatus({ loading: false, error: null, signature: null, endpoint: null });
    setActiveModal(null);
  };

  const setLoadingStatus = () => {
    setLocalStatus({ loading: true, error: null, signature: null, endpoint: null });
  };

  const setValidationError = (message: string) => {
    setLocalStatus({ loading: false, error: message, signature: null, endpoint: null });
  };

  const parsePublicKey = (value: string, label: string): PublicKey | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      setValidationError(`${label} is required`);
      return null;
    }

    try {
      return new PublicKey(trimmed);
    } catch {
      setValidationError(`${label} is invalid`);
      return null;
    }
  };

  // Update randomReward user field when wallet changes and populate existing data
  useEffect(() => {
    setForms((prev) => {
      const nextRandomRewardUser = publicKey?.toString() || "";
      const nextAdmins =
        distributor?.admins && distributor.admins.length > 0
          ? distributor.admins.map((addr) => addr.toString()).join("\n")
          : prev.admins;
      const nextWhitelist =
        distributor?.whitelist && distributor.whitelist.length > 0
          ? distributor.whitelist.map((addr) => addr.toString()).join("\n")
          : prev.whitelist;
      const nextRewardList = rewardList
        ? {
            globalRangeMin: rewardList.globalRangeMin || 0,
            globalRangeMax: rewardList.globalRangeMax || 1000,
            startTimestamp: rewardList.startTimestamp || Math.floor(Date.now() / 1000),
            endTimestamp: rewardList.endTimestamp || Math.floor(Date.now() / 1000) + 86400,
          }
        : prev.rewardList;

      const isUnchanged =
        prev.randomReward.user === nextRandomRewardUser &&
        prev.admins === nextAdmins &&
        prev.whitelist === nextWhitelist &&
        prev.rewardList.globalRangeMin === nextRewardList.globalRangeMin &&
        prev.rewardList.globalRangeMax === nextRewardList.globalRangeMax &&
        prev.rewardList.startTimestamp === nextRewardList.startTimestamp &&
        prev.rewardList.endTimestamp === nextRewardList.endTimestamp;

      if (isUnchanged) {
        return prev;
      }

      return {
        ...prev,
        admins: nextAdmins,
        whitelist: nextWhitelist,
        rewardList: nextRewardList,
        randomReward: {
          ...prev.randomReward,
          user: nextRandomRewardUser,
        },
      };
    });
  }, [publicKey, distributor, rewardList]);

  useEffect(() => {
    let cancelled = false;

    const loadDistributorMints = async () => {
      if ((activeModal !== "addReward" && activeModal !== "updateReward") || !targetDistributor) {
        if (!cancelled) {
          setAvailableDistributorMints([]);
          setLoadingDistributorMints(false);
          setDistributorMintFetchError(null);
        }
        return;
      }

      setLoadingDistributorMints(true);
      setDistributorMintFetchError(null);

      try {
        const mintFetchResult = await fetchOwnedSplMintOptions(
          connection,
          targetDistributor
        );
        if (!cancelled) {
          setAvailableDistributorMints(mintFetchResult.options);
        }
      } catch (error) {
        console.error("[AdminActions] Failed to load distributor token mints:", error);
        if (!cancelled) {
          setAvailableDistributorMints([]);
          setDistributorMintFetchError(error instanceof Error ? error.message : "Unknown fetch error");
        }
      } finally {
        if (!cancelled) {
          setLoadingDistributorMints(false);
        }
      }
    };

    void loadDistributorMints();

    return () => {
      cancelled = true;
    };
  }, [activeModal, connection.rpcEndpoint, targetDistributorKey]);

  // Helper to handle transaction result
  const handleTransactionResult = async (
    result: any,
    actionName: string,
    onSuccess?: () => void,
    endpoint?: string
  ) => {

    if (result.signature) {
      // Get the cluster endpoint from connection
      const clusterEndpoint =
        result.endpoint || endpoint || connection.rpcEndpoint || getDefaultSolanaEndpoint();
      
      const txId = addTransaction(
        result.signature,
        actionName,
        "devnet",
        clusterEndpoint
      );
      
      // Build error message
      let errorMessage = null;
      if (!result.success && result.error) {
        errorMessage = `Transaction failed: ${result.error}`;
      }
      
      updateTransaction(txId, {
        status: result.success ? "confirmed" : "failed",
        error: result.error,
      });

      setLocalStatus({
        loading: false,
        error: errorMessage,
        signature: result.signature,
        endpoint: result.endpoint || clusterEndpoint,
      });
      
      // Only auto-close on success
      if (result.success) {
        requestDashboardDataRefresh();
        setTimeout(() => {
          setActiveModal(null);
          onSuccess?.();
          setLocalStatus({ loading: false, error: null, signature: null, endpoint: null });
        }, 2000);
      }
    } else {
      setLocalStatus({
        loading: false,
        error: result.error || "Unknown error",
        signature: null,
        endpoint: result.endpoint || null,
      });
    }
  };

  const handleInitialize = async () => {
    setLoadingStatus();
    const result = await initializeRewardDistributor([]);
    await handleTransactionResult(result, "Initialize Distributor");
  };

  const handleSetAdmins = async () => {
    setLoadingStatus();
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
    setLoadingStatus();
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
    setLoadingStatus();
    const config = forms.rewardList;
    const existingStartTimestamp = rewardList ? Number(rewardList.startTimestamp) : null;
    const existingEndTimestamp = rewardList ? Number(rewardList.endTimestamp) : null;
    const existingGlobalRangeMin = rewardList ? rewardList.globalRangeMin : null;
    const existingGlobalRangeMax = rewardList ? rewardList.globalRangeMax : null;

    const result = await setRewardList(
      rewardList && config.globalRangeMin === existingGlobalRangeMin
        ? null
        : config.globalRangeMin,
      rewardList && config.globalRangeMax === existingGlobalRangeMax
        ? null
        : config.globalRangeMax,
      rewardList && config.startTimestamp === existingStartTimestamp
        ? null
        : config.startTimestamp,
      rewardList && config.endTimestamp === existingEndTimestamp
        ? null
        : config.endTimestamp
    );
    await handleTransactionResult(result, "Set Reward List");
  };

  const handleRequestRandomReward = async () => {
    setLoadingStatus();
    const config = forms.randomReward;
    const user = parsePublicKey(config.user, "User address");
    if (!user) return;
    const clientSeed = Math.floor(Math.random() * 255);
    
    const result = await requestRandomReward(
      user,
      clientSeed
    );
    
    if (result.signature) {
      // Get the cluster endpoint from connection
      const clusterEndpoint = result.endpoint || connection.rpcEndpoint || "https://api.devnet.solana.com";
      
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
        endpoint: result.endpoint || clusterEndpoint,
      });
      
      if (result.success) {
        requestDashboardDataRefresh();
        setTimeout(() => {
          setActiveModal(null);
          setLocalStatus({ loading: false, error: null, signature: null, endpoint: null });
        }, 2000);
      }
    } else {
      setLocalStatus({
        loading: false,
        error: result.error || "Unknown error",
        signature: null,
        endpoint: result.endpoint || null,
      });
    }
  };

  const handleAddReward = async () => {
    setLoadingStatus();
    const config = forms.addReward;
    if (!config.rewardName.trim()) {
      setValidationError("Reward name is required");
      return;
    }

    const rewardMint = parsePublicKey(config.rewardMint, "Mint address");
    if (!rewardMint) return;

    if (!rewardList?.rewardDistributor) {
      setValidationError("Reward list is not loaded for the selected distributor");
      return;
    }

    const rewardDistributor = parsePublicKey(
      rewardList.rewardDistributor.toString(),
      "Reward distributor"
    );
    if (!rewardDistributor) return;

    const selectedDistributorMint =
      availableDistributorMints.find(
        (option) => option.tokenAccount === config.rewardMint.trim()
      ) ??
      availableDistributorMints.find((option) => option.mint === rewardMint.toBase58());
    const tokenAccount = selectedDistributorMint
      ? new PublicKey(selectedDistributorMint.tokenAccount)
      : getAssociatedTokenAddressSync(rewardMint, rewardDistributor, true);
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
      selectedExistingAddReward ? undefined : config.drawRangeMin,
      selectedExistingAddReward ? undefined : config.drawRangeMax,
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
    setLoadingStatus();
    const config = forms.removeReward;
    if (!config.rewardName.trim()) {
      setValidationError("Reward name is required");
      return;
    }

    const parsedRewardMint = config.rewardMint
      ? parsePublicKey(config.rewardMint, "Mint address")
      : null;
    const rewardMint = parsedRewardMint ?? undefined;
    if (config.rewardMint && !rewardMint) return;

    const result = await removeReward(
      config.rewardName,
      rewardMint,
      config.redemptionAmount
    );

    await handleTransactionResult(result, "Remove Reward", () => {
      setForms({ ...forms, removeReward: { rewardName: "", rewardMint: "", redemptionAmount: 1 } });
    });
  };

  const handleUpdateReward = async () => {
    setLoadingStatus();
    const config = forms.updateReward;

    if (!config.currentRewardName.trim()) {
      setValidationError("Current reward is required");
      return;
    }
    let rewardMint: PublicKey | null = null;
    let tokenAccount: PublicKey | null = null;

    if (!isSelectedUpdateRewardNft) {
      const parsedRewardMint = parsePublicKey(
        config.rewardMint || selectedRewardForUpdate?.rewardMints?.[0]?.toString?.() || "",
        "Mint address"
      );
      if (!parsedRewardMint) return;
      rewardMint = parsedRewardMint;

      if (!rewardList?.rewardDistributor) {
        setValidationError("Reward list is not loaded for the selected distributor");
        return;
      }

      const rewardDistributor = parsePublicKey(
        rewardList.rewardDistributor.toString(),
        "Reward distributor"
      );
      if (!rewardDistributor) return;

      const selectedDistributorMint =
        availableDistributorMints.find((option) => option.tokenAccount === config.rewardMint.trim()) ??
        availableDistributorMints.find((option) => option.mint === parsedRewardMint.toBase58());
      tokenAccount = selectedDistributorMint
        ? new PublicKey(selectedDistributorMint.tokenAccount)
        : getAssociatedTokenAddressSync(parsedRewardMint, rewardDistributor, true);
    }

    const result = await updateReward(
      config.currentRewardName,
      config.rewardName.trim() && config.rewardName.trim() !== config.currentRewardName
        ? config.rewardName.trim()
        : null,
      rewardMint,
      tokenAccount,
      !isSelectedUpdateRewardNft &&
      config.rewardAmount !== selectedRewardForUpdate?.rewardAmount
        ? config.rewardAmount
        : null,
      config.drawRangeMin !== selectedRewardForUpdate?.drawRangeMin
        ? config.drawRangeMin
        : null,
      config.drawRangeMax !== selectedRewardForUpdate?.drawRangeMax
        ? config.drawRangeMax
        : null
    );

    await handleTransactionResult(result, "Update Reward", () => {
      setForms({
        ...forms,
        updateReward: {
          currentRewardName: "",
          rewardName: "",
          rewardMint: "",
          rewardAmount: 1,
          drawRangeMin: 0,
          drawRangeMax: 0,
        },
      });
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

        <button
          onClick={() => setActiveModal("updateReward")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <List className="w-5 h-5 text-cyan-400 group-hover:text-cyan-300" />
          <span className="text-left">
            <div className="font-medium text-white">Update Reward</div>
            <div className="text-xs text-gray-400">Update name, amount, and range for an existing reward</div>
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
        endpoint={localStatus.endpoint || connection.rpcEndpoint}
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
        endpoint={localStatus.endpoint || connection.rpcEndpoint}
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
              📝 {forms.admins.split('\n').filter((a: string) => a.trim()).length} address(es) to be set
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
        endpoint={localStatus.endpoint || connection.rpcEndpoint}
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
              📝 {forms.whitelist.split('\n').filter((a: string) => a.trim()).length} address(es) to be set
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
       endpoint={localStatus.endpoint || connection.rpcEndpoint}
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
         {rewardRangeSummary.length > 0 && (
           <div className="rounded border border-gray-700 bg-gray-900/60 p-3">
             <p className="mb-2 text-sm font-medium text-gray-200">Current Range Usage</p>
             <div className="space-y-1 text-xs text-gray-400">
               {rewardRangeSummary.map((reward) => (
                 <div
                   key={`${reward.name}-${reward.drawRangeMin}-${reward.drawRangeMax}`}
                   className="flex items-center justify-between gap-3"
                 >
                   <span className="truncate text-gray-300">{reward.name}</span>
                   <span className="whitespace-nowrap">
                     {reward.drawRangeMin} - {reward.drawRangeMax}
                   </span>
                 </div>
               ))}
             </div>
           </div>
         )}
           </div>
           </TransactionModal>

      {/* Request Random Reward Modal */}
      <TransactionModal
        isOpen={activeModal === "randomReward"}
        title="Request Random Reward"
        description="Request a random reward for a user"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={localStatus.endpoint || connection.rpcEndpoint}
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
              endpoint={localStatus.endpoint || connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleAddReward}
      >
        <div className="space-y-3 max-h-96 overflow-y-auto">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Reward Name</label>
            <select
              value={availableRewardNames.includes(forms.addReward.rewardName) ? forms.addReward.rewardName : ""}
              onChange={(e) => {
                const selectedReward = (rewardList?.rewards ?? []).find(
                  (reward: any) =>
                    reward.name === e.target.value || reward.rewardName === e.target.value
                );

                setForms({
                  ...forms,
                    addReward: {
                      ...forms.addReward,
                      rewardName: e.target.value,
                      drawRangeMin: selectedReward?.drawRangeMin ?? forms.addReward.drawRangeMin,
                      drawRangeMax: selectedReward?.drawRangeMax ?? forms.addReward.drawRangeMax,
                      rewardAmount: selectedReward?.rewardAmount ?? forms.addReward.rewardAmount,
                      redemptionLimit:
                        selectedReward &&
                        !(
                          Object.keys(selectedReward.rewardType ?? {})[0] === "legacyNft" ||
                          Object.keys(selectedReward.rewardType ?? {})[0] === "programmableNft"
                        )
                          ? 1
                          : forms.addReward.redemptionLimit,
                    },
                  });
              }}
              disabled={localStatus.loading || availableRewardNames.length === 0}
              className="w-full rounded border border-gray-600 bg-gray-700 p-2 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">
                {availableRewardNames.length > 0 ? "Add new reward" : "No existing rewards found"}
              </option>
              {availableRewardNames.map((rewardName) => (
                <option key={rewardName} value={rewardName}>
                  {rewardName}
                </option>
              ))}
            </select>
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
              className="mt-2 w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
              {selectedExistingAddReward && (
                <p className="text-xs text-gray-400 mt-1">
                  Existing rewards keep their current range. Use "Update Reward" to change it.
                </p>
              )}
              </div>
              <div>
              <label className="block text-sm text-gray-300 mb-1">Mint Address</label>
              {distributorMintFetchError && (
                <div className="mt-2 rounded border border-red-700 bg-red-900/20 p-2 text-xs text-red-300">
                  Fetch error: {distributorMintFetchError}
                </div>
              )}
              <select
                value={forms.addReward.rewardMint}
                onChange={(e) =>
                  setForms({
                    ...forms,
                    addReward: {
                      ...forms.addReward,
                      rewardMint: e.target.value,
                      rewardAmount:
                        availableDistributorMints.find((option) => option.mint === e.target.value)
                          ?.isNftLike
                          ? 1
                          : forms.addReward.rewardAmount,
                    },
                  })
                }
                disabled={localStatus.loading || loadingDistributorMints || availableDistributorMints.length === 0}
                className="mt-2 w-full rounded border border-gray-600 bg-gray-700 p-2 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
              >
                <option value="">
                  {availableDistributorMints.length > 0 ? "Select distributor mint" : "No distributor token accounts found"}
                </option>
                {availableDistributorMints.map((option) => (
                  <option key={option.tokenAccount} value={option.mint}>
                    {shortAddress(option.mint, 5)} ({option.balanceLabel})
                  </option>
                ))}
              </select>
              </div>
          {(!shouldHideAddRewardAmount || !shouldHideAddRewardRedemptionIncrease) && (
            <div
              className={`grid gap-2 ${
                !shouldHideAddRewardAmount && !shouldHideAddRewardRedemptionIncrease
                  ? "grid-cols-2"
                  : "grid-cols-1"
              }`}
            >
              {!shouldHideAddRewardAmount && (
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
              )}
              {!shouldHideAddRewardRedemptionIncrease && (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Redemption Count Increase</label>
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
              )}
            </div>
          )}
          {isSelectedAddRewardNft && (
            <p className="text-xs text-gray-400">
              NFT rewards use amount 1 and redemption count increase 1 automatically.
            </p>
          )}
                {!selectedExistingAddReward && (
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
                )}
          {!selectedExistingAddReward && rewardRangeSummary.length > 0 && (
            <div className="rounded border border-gray-700 bg-gray-900/60 p-3">
              <p className="mb-2 text-sm font-medium text-gray-200">Current Range Usage</p>
              <div className="space-y-1 text-xs text-gray-400">
                {rewardRangeSummary.map((reward) => (
                  <div
                    key={`${reward.name}-${reward.drawRangeMin}-${reward.drawRangeMax}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="truncate text-gray-300">{reward.name}</span>
                    <span className="whitespace-nowrap">
                      {reward.drawRangeMin} - {reward.drawRangeMax}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </TransactionModal>

      <TransactionModal
        isOpen={activeModal === "updateReward"}
        title="Update Reward"
        description="Update the name, amount, and draw range for an existing reward"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={localStatus.endpoint || connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleUpdateReward}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Current Reward</label>
            <select
              value={forms.updateReward.currentRewardName}
              onChange={(e) => {
                const reward = (rewardList?.rewards ?? []).find(
                  (item: any) =>
                    item.name === e.target.value || item.rewardName === e.target.value
                );
                setForms({
                  ...forms,
                  updateReward: {
                    currentRewardName: e.target.value,
                    rewardName: reward?.name || e.target.value,
                    rewardMint: reward?.rewardMints?.[0]?.toString?.() || "",
                    rewardAmount: reward?.rewardAmount ?? 1,
                    drawRangeMin: reward?.drawRangeMin ?? 0,
                    drawRangeMax: reward?.drawRangeMax ?? 0,
                  },
                });
              }}
              disabled={localStatus.loading || availableRewardNames.length === 0}
              className="w-full rounded border border-gray-600 bg-gray-700 p-2 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">
                {availableRewardNames.length > 0 ? "Select reward" : "No existing rewards found"}
              </option>
              {availableRewardNames.map((rewardName) => (
                <option key={rewardName} value={rewardName}>
                  {rewardName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Updated Reward Name</label>
            <input
              type="text"
              value={forms.updateReward.rewardName}
              onChange={(e) =>
                setForms({
                  ...forms,
                  updateReward: {
                    ...forms.updateReward,
                    rewardName: e.target.value,
                  },
                })
              }
              disabled={localStatus.loading || !selectedRewardForUpdate}
              className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Reward Type</label>
            <input
              type="text"
              value={selectedUpdateRewardTypeLabel}
              disabled
              className="w-full p-2 bg-gray-800 text-gray-300 rounded border border-gray-700 focus:outline-none disabled:opacity-100 text-sm"
            />
          </div>
          {!isSelectedUpdateRewardNft && (
            <div>
              <label className="block text-sm text-gray-300 mb-1">Reward Amount</label>
              <input
                type="number"
                value={forms.updateReward.rewardAmount}
                onChange={(e) =>
                  setForms({
                    ...forms,
                    updateReward: {
                      ...forms.updateReward,
                      rewardAmount: parseInt(e.target.value) || 0,
                    },
                  })
                }
                disabled={localStatus.loading || !selectedRewardForUpdate}
                className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Range Min</label>
              <input
                type="number"
                value={forms.updateReward.drawRangeMin}
                onChange={(e) =>
                  setForms({
                    ...forms,
                    updateReward: {
                      ...forms.updateReward,
                      drawRangeMin: parseInt(e.target.value),
                    },
                  })
                }
                disabled={localStatus.loading || !selectedRewardForUpdate}
                className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Range Max</label>
              <input
                type="number"
                value={forms.updateReward.drawRangeMax}
                onChange={(e) =>
                  setForms({
                    ...forms,
                    updateReward: {
                      ...forms.updateReward,
                      drawRangeMax: parseInt(e.target.value),
                    },
                  })
                }
                disabled={localStatus.loading || !selectedRewardForUpdate}
                className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
            </div>
          </div>
          {rewardRangeSummary.length > 0 && (
            <div className="rounded border border-gray-700 bg-gray-900/60 p-3">
              <p className="mb-2 text-sm font-medium text-gray-200">Current Range Usage</p>
              <div className="space-y-1 text-xs text-gray-400">
                {rewardRangeSummary.map((reward) => (
                  <div
                    key={`${reward.name}-${reward.drawRangeMin}-${reward.drawRangeMax}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="truncate text-gray-300">{reward.name}</span>
                    <span className="whitespace-nowrap">
                      {reward.drawRangeMin} - {reward.drawRangeMax}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
        endpoint={localStatus.endpoint || connection.rpcEndpoint}
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
                  const reward = rewardList.rewards?.find(
                    (r: any) => r.name === e.target.value || r.rewardName === e.target.value
                  );
                setForms({
                  ...forms,
                  removeReward: {
                      rewardName: e.target.value,
                      rewardMint: reward?.rewardMints[0]?.toString() || "",
                      redemptionAmount: 1,
                    },
                  });
                }}
                disabled={localStatus.loading}
                className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              >
                <option value="">-- Select a reward --</option>
                {rewardList.rewards.map((reward: any, idx: number) => (
                  <option key={idx} value={reward.name || reward.rewardName}>
                    {reward.name || reward.rewardName} ({(reward.redemptionLimit - reward.redemptionCount)?.toString() || "0"})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">Mint Address</label>
            <select
              value={forms.removeReward.rewardMint}
              onChange={(e) =>
                setForms({
                  ...forms,
                  removeReward: { ...forms.removeReward, rewardMint: e.target.value },
                })
              }
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
            >
              <option value="">
                {availableRewardRemovalMints.length > 0
                  ? "Select reward mint"
                  : "No reward mints found"}
              </option>
              {availableRewardRemovalMints.map((mint) => (
                <option key={mint} value={mint}>
                  {shortAddress(mint, 5)}
                </option>
              ))}
            </select>
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
            💡 Select the reward and mint from the dropdowns, then choose the redemption amount
          </div>
        </div>
      </TransactionModal>
    </div>
  );
};
