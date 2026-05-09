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
  Coins,
} from "lucide-react";
import { useTransaction } from "@/hooks/useTransaction";
import { useGlobalTransactionHistory } from "@/hooks/useGlobalTransactionHistory";
import { useRewardData } from "@/hooks/useRewardData";
import { PDAs } from "@/lib/pda";
import { getBaseLayerSolanaEndpoint, getDefaultSolanaEndpoint } from "@/lib/clusterContext";
import { resolveEndpoint } from "@/lib/endpoints";
import { Connection } from "@solana/web3.js";
import { Metadata } from "@metaplex-foundation/mpl-token-metadata";
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
    addRewardsBatch,
    removeReward,
    removeRewardsBatch,
    updateReward,
    sendSponsoredLamportsToRewardList,
  } = useTransaction({ 
    selectedDistributor,
    onTransactionAdd: addTransaction,
    onTransactionUpdate: updateTransaction,
    });

  // Use selected distributor if available, otherwise use primary (PDA-derived)
  const targetDistributor = selectedDistributor || (publicKey ? PDAs.getRewardDistributor(publicKey)[0] : null);
  const targetDistributorKey = targetDistributor?.toBase58() ?? null;
  const { distributor, rewardList } = useRewardData(publicKey, targetDistributor);

  const rewardListPda = targetDistributor ? PDAs.getRewardList(targetDistributor)[0] : null;

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
    fundRewardList: {
      amountSol: "",
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
  const [mintSymbols, setMintSymbols] = useState<Map<string, string>>(new Map());

  // SOL balance of the reward list PDA, fetched from the ER endpoint when the fund modal opens
  const [rewardListBalance, setRewardListBalance] = useState<{
    totalLamports: number;
    rentExemptLamports: number;
    loading: boolean;
  } | null>(null);

  useEffect(() => {
    if (activeModal !== "fundRewardList" || !rewardListPda) {
      setRewardListBalance(null);
      return;
    }

    let cancelled = false;
    setRewardListBalance({ totalLamports: 0, rentExemptLamports: 0, loading: true });

    const fetchBalance = async () => {
      try {
        // If delegated, account lives on the ER; otherwise on the Solana base layer
        const targetEndpoint = rewardList?.delegated
          ? resolveEndpoint(connection.rpcEndpoint, "magicblock")
          : resolveEndpoint(connection.rpcEndpoint, "solana");
        const targetConnection = new Connection(targetEndpoint, "confirmed");

        // Use getBalance() to avoid superstruct validation errors on ER getAccountInfo responses
        const lamports = await targetConnection.getBalance(rewardListPda, "confirmed");
        if (!lamports) {
          setRewardListBalance({ totalLamports: 0, rentExemptLamports: 0, loading: false });
          return;
        }

        // Fetch data size from Solana base layer to compute rent-exempt minimum
        const solEndpoint = resolveEndpoint(connection.rpcEndpoint, "solana");
        const solConnection = solEndpoint === targetEndpoint
          ? targetConnection
          : new Connection(solEndpoint, "confirmed");
        const solAccountInfo = await solConnection.getAccountInfo(rewardListPda);
        const dataLength = solAccountInfo?.data.length ?? 0;
        const rentExempt = await solConnection.getMinimumBalanceForRentExemption(dataLength);

        if (!cancelled) {
          setRewardListBalance({
            totalLamports: lamports,
            rentExemptLamports: rentExempt,
            loading: false,
          });
        }
      } catch {
        if (!cancelled) {
          setRewardListBalance({ totalLamports: 0, rentExemptLamports: 0, loading: false });
        }
      }
    };

    void fetchBalance();
    return () => { cancelled = true; };
  }, [activeModal, rewardListPda?.toBase58(), connection.rpcEndpoint, rewardList?.delegated]);

  // Auto-fill the suggested top-up amount once the balance resolves
  useEffect(() => {
    if (activeModal !== "fundRewardList" || !rewardListBalance || rewardListBalance.loading) return;

    const LAMPORTS_PER_TX = 50_000;
    // Rent-exempt minimum for a 165-byte SPL token account (ATA created on each redemption)
    const LAMPORTS_PER_TOKEN_ACCOUNT = 2_039_280;
    const LAMPORTS_PER_REDEMPTION = LAMPORTS_PER_TX + LAMPORTS_PER_TOKEN_ACCOUNT;
    const totalRemaining = (rewardList?.rewards ?? []).reduce(
      (sum: number, r: any) => sum + Math.max(0, Number(r.redemptionLimit) - Number(r.redemptionCount)),
      0
    );

    // Lamports needed to cover all remaining redemptions + 20% buffer
    const neededLamports = Math.ceil(totalRemaining * LAMPORTS_PER_REDEMPTION * 1.2);
    const currentExcess = rewardListBalance.totalLamports - rewardListBalance.rentExemptLamports;
    const deficitLamports = Math.max(0, neededLamports - currentExcess);

    const sol = deficitLamports / 1e9;
    const suggested = deficitLamports === 0 ? "0" : sol.toFixed(9).replace(/\.?0+$/, "");

    setForms((prev) => ({ ...prev, fundRewardList: { amountSol: suggested } }));
  }, [activeModal, rewardListBalance]);

  interface BatchRewardEntry {
    rewardName: string;
    rewardMint: string;
    rewardAmount: number;
    drawRangeMin: number;
    drawRangeMax: number;
    redemptionLimit: number;
    isNftLike: boolean;
  }
  const [batchRewards, setBatchRewards] = useState<BatchRewardEntry[]>([]);

  interface BatchRemoveRewardEntry {
    rewardName: string;
    rewardMint: string;
    redemptionAmount: number;
  }
  const [batchRemoveRewards, setBatchRemoveRewards] = useState<BatchRemoveRewardEntry[]>([]);

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
  const alreadyAddedRewardMints = new Set(
    (rewardList?.rewards ?? []).flatMap((reward: any) =>
      (reward.rewardMints ?? []).map((mint: any) => mint?.toString?.())
    ).filter(Boolean)
  );
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
    setBatchRewards([]);
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

  // Fetch Metaplex metadata names for all known mints
  useEffect(() => {
    let cancelled = false;
    const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

    const fetchNames = async () => {
      const allMintStrings = new Set<string>();
      for (const opt of availableDistributorMints) allMintStrings.add(opt.mint);
      for (const m of availableRewardRemovalMints) allMintStrings.add(m);

      // Only fetch mints we don't already have names for
      const toFetch = Array.from(allMintStrings).filter((m) => !mintSymbols.has(m));
      if (toFetch.length === 0) return;

      try {
        const readEndpoint = getBaseLayerSolanaEndpoint(connection.rpcEndpoint);
        const readConnection =
          readEndpoint === connection.rpcEndpoint
            ? connection
            : new Connection(readEndpoint, "confirmed");

        const mintKeys = toFetch.map((m) => new PublicKey(m));
        const metadataPdas = mintKeys.map(
          (mint) =>
            PublicKey.findProgramAddressSync(
              [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
              METADATA_PROGRAM_ID
            )[0]
        );

        const accounts = await readConnection.getMultipleAccountsInfo(metadataPdas);
        const newNames = new Map(mintSymbols);

        mintKeys.forEach((mint, index) => {
          const account = accounts[index];
          if (!account) return;
          try {
            const [metadata] = Metadata.deserialize(account.data);
            const symbol =
              typeof metadata.data.symbol === "string"
                ? metadata.data.symbol.replace(/\0/g, "").trim()
                : "";
            if (symbol) newNames.set(mint.toBase58(), symbol);
          } catch {
            // no metadata for this mint
          }
        });

        if (!cancelled) setMintSymbols(newNames);
      } catch (error) {
        console.error("[AdminActions] Failed to fetch mint metadata names:", error);
      }
    };

    void fetchNames();
    return () => { cancelled = true; };
  }, [availableDistributorMints, availableRewardRemovalMints, connection.rpcEndpoint]);

  // Helper to handle transaction result
  const handleTransactionResult = async (
    result: any,
    actionName: string,
    onSuccess?: () => void,
    endpoint?: string
  ) => {

    if ('signature' in result && result.signature) {
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
        endpoint: ('endpoint' in result ? result.endpoint : null) || null,
      });
    }
  };

  const handleFundRewardList = async () => {
    if (!rewardListPda) {
      setValidationError("No distributor selected");
      return;
    }
    const solAmount = parseFloat(forms.fundRewardList.amountSol);
    if (isNaN(solAmount) || solAmount <= 0) {
      setValidationError("Enter a valid SOL amount");
      return;
    }
    setLoadingStatus();
    const lamports = BigInt(Math.floor(solAmount * 1_000_000_000));
    const result = await sendSponsoredLamportsToRewardList(rewardListPda, lamports);
    await handleTransactionResult(result, "Fund Reward List (Sponsored Lamports)", () => {
      setForms((prev) => ({ ...prev, fundRewardList: { amountSol: "" } }));
    });
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

    if ('signature' in result && result.signature) {
      // Get the cluster endpoint from connection
      const clusterEndpoint = result.endpoint || connection.rpcEndpoint || "https://api.devnet.solana.com";

      // Add the request transaction to history FIRST
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

      // Now await the VRF callback and add it AFTER the request entry
      if (result.callbackPromise) {
        result.callbackPromise.then((callbackData) => {
          if (callbackData) {
            // Extract result number from log like "Random result: 42 for user: ..."
            const resultMatch = callbackData.relevantLogs
              .find(l => l.includes("Random result:"))
              ?.match(/Random result:\s*(\d+)/);
            const resultSuffix = resultMatch ? `: ${resultMatch[1]}` : "";
            const callbackTxId = addTransaction(
              callbackData.signature,
              `Consume Random Reward VRF Callback${resultSuffix}`,
              "devnet",
              clusterEndpoint
            );
            updateTransaction(callbackTxId, {
              status: callbackData.txStatus,
              error: callbackData.error,
            });
          }
        });
      }

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
        endpoint: ('endpoint' in result ? result.endpoint : null) || null,
      });
    }
  };

  const handleAddToBatch = () => {
    const config = forms.addReward;
    if (!config.rewardName.trim()) {
      setValidationError("Reward name is required");
      return;
    }
    if (!config.rewardMint.trim()) {
      setValidationError("Mint address is required");
      return;
    }

    const mintOption = availableDistributorMints.find(
      (option) => option.mint === config.rewardMint
    );

    setBatchRewards((prev) => [
      ...prev,
      {
        rewardName: config.rewardName.trim(),
        rewardMint: config.rewardMint.trim(),
        rewardAmount: config.rewardAmount,
        drawRangeMin: selectedExistingAddReward ? selectedExistingAddReward.drawRangeMin : config.drawRangeMin,
        drawRangeMax: selectedExistingAddReward ? selectedExistingAddReward.drawRangeMax : config.drawRangeMax,
        redemptionLimit: config.redemptionLimit,
        isNftLike: mintOption?.isNftLike ?? false,
      },
    ]);

    setForms({
      ...forms,
      addReward: {
        ...forms.addReward,
        rewardMint: "",
        rewardAmount: 1,
        redemptionLimit: 1,
      },
    });
    setLocalStatus({ ...localStatus, error: null });
  };

  const handleAddReward = async () => {
    const allEntries = [...batchRewards];

    // Include current form if filled
    const config = forms.addReward;
    if (config.rewardName.trim() && config.rewardMint.trim()) {
      const mintOption = availableDistributorMints.find(
        (option) => option.mint === config.rewardMint
      );
      allEntries.push({
        rewardName: config.rewardName.trim(),
        rewardMint: config.rewardMint.trim(),
        rewardAmount: config.rewardAmount,
        drawRangeMin: selectedExistingAddReward ? selectedExistingAddReward.drawRangeMin : config.drawRangeMin,
        drawRangeMax: selectedExistingAddReward ? selectedExistingAddReward.drawRangeMax : config.drawRangeMax,
        redemptionLimit: config.redemptionLimit,
        isNftLike: mintOption?.isNftLike ?? false,
      });
    }

    if (allEntries.length === 0) {
      setValidationError("No rewards to add");
      return;
    }

    setLoadingStatus();

    if (!rewardList?.rewardDistributor) {
      setValidationError("Reward list is not loaded for the selected distributor");
      return;
    }

    const rewardDistributor = parsePublicKey(
      rewardList.rewardDistributor.toString(),
      "Reward distributor"
    );
    if (!rewardDistributor) return;

    const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

    if (allEntries.length === 1) {
      // Single reward - use original addReward for backward compatibility
      const entry = allEntries[0];
      const rewardMint = parsePublicKey(entry.rewardMint, "Mint address");
      if (!rewardMint) return;

      const selectedDistributorMint =
        availableDistributorMints.find(
          (option) => option.tokenAccount === entry.rewardMint
        ) ??
        availableDistributorMints.find((option) => option.mint === rewardMint.toBase58());
      const tokenAccount = selectedDistributorMint
        ? new PublicKey(selectedDistributorMint.tokenAccount)
        : getAssociatedTokenAddressSync(rewardMint, rewardDistributor, true);
      const [metadataAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), rewardMint.toBuffer()],
        METADATA_PROGRAM_ID
      );

      const existingReward = (rewardList?.rewards ?? []).find(
        (r: any) => r.name === entry.rewardName || r.rewardName === entry.rewardName
      );

      const result = await addReward(
        entry.rewardName,
        rewardMint,
        tokenAccount,
        entry.rewardAmount,
        existingReward ? undefined : entry.drawRangeMin,
        existingReward ? undefined : entry.drawRangeMax,
        entry.redemptionLimit,
        metadataAccount
      );
      await handleTransactionResult(result, "Add Reward", () => {
        setBatchRewards([]);
        setForms({
          ...forms,
          addReward: {
            rewardName: "",
            rewardMint: "",
            rewardAmount: 1,
            drawRangeMin: 0,
            drawRangeMax: 0,
            redemptionLimit: 1,
          },
        });
      });
    } else {
      // Multiple rewards - batch into single transaction
      const batchParams = allEntries.map((entry) => {
        const rewardMint = new PublicKey(entry.rewardMint);
        const selectedDistributorMint =
          availableDistributorMints.find(
            (option) => option.tokenAccount === entry.rewardMint
          ) ??
          availableDistributorMints.find((option) => option.mint === rewardMint.toBase58());
        const tokenAccount = selectedDistributorMint
          ? new PublicKey(selectedDistributorMint.tokenAccount)
          : getAssociatedTokenAddressSync(rewardMint, rewardDistributor, true);
        const [metadataAccount] = PublicKey.findProgramAddressSync(
          [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), rewardMint.toBuffer()],
          METADATA_PROGRAM_ID
        );

        const existingReward = (rewardList?.rewards ?? []).find(
          (r: any) => r.name === entry.rewardName || r.rewardName === entry.rewardName
        );

        return {
          rewardName: entry.rewardName,
          rewardMint,
          tokenAccount,
          rewardAmount: entry.rewardAmount,
          drawRangeMin: existingReward ? undefined : entry.drawRangeMin,
          drawRangeMax: existingReward ? undefined : entry.drawRangeMax,
          redemptionLimit: entry.redemptionLimit,
          metadataAccount,
        };
      });

      const result = await addRewardsBatch(batchParams);
      await handleTransactionResult(result, `Add ${allEntries.length} Rewards`, () => {
        setBatchRewards([]);
        setForms({
          ...forms,
          addReward: {
            rewardName: "",
            rewardMint: "",
            rewardAmount: 1,
            drawRangeMin: 0,
            drawRangeMax: 0,
            redemptionLimit: 1,
          },
        });
      });
    }
  };

  const handleAddToRemoveBatch = () => {
    const config = forms.removeReward;
    if (!config.rewardName.trim()) {
      setValidationError("Reward name is required");
      return;
    }
    if (!config.rewardMint.trim()) {
      setValidationError("Mint address is required");
      return;
    }

    setBatchRemoveRewards((prev) => [
      ...prev,
      {
        rewardName: config.rewardName.trim(),
        rewardMint: config.rewardMint.trim(),
        redemptionAmount: config.redemptionAmount,
      },
    ]);

    setForms({
      ...forms,
      removeReward: {
        ...forms.removeReward,
        rewardMint: "",
        redemptionAmount: 1,
      },
    });
    setLocalStatus({ ...localStatus, error: null });
  };

  const handleRemoveReward = async () => {
    const allEntries = [...batchRemoveRewards];

    // Include current form if filled
    const config = forms.removeReward;
    if (config.rewardName.trim() && config.rewardMint.trim()) {
      allEntries.push({
        rewardName: config.rewardName.trim(),
        rewardMint: config.rewardMint.trim(),
        redemptionAmount: config.redemptionAmount,
      });
    }

    if (allEntries.length === 0) {
      setValidationError("No rewards to remove");
      return;
    }

    setLoadingStatus();

    const resetForm = () => {
      setBatchRemoveRewards([]);
      setForms({ ...forms, removeReward: { rewardName: "", rewardMint: "", redemptionAmount: 1 } });
    };

    if (allEntries.length === 1) {
      // Single reward - use original removeReward for backward compatibility
      const entry = allEntries[0];
      const parsedRewardMint = entry.rewardMint
        ? parsePublicKey(entry.rewardMint, "Mint address")
        : null;
      const rewardMint = parsedRewardMint ?? undefined;
      if (entry.rewardMint && !rewardMint) return;

      const result = await removeReward(
        entry.rewardName,
        rewardMint,
        entry.redemptionAmount
      );

      await handleTransactionResult(result, "Remove Reward", resetForm);
    } else {
      // Multiple rewards - batch into single transaction
      const batchParams = allEntries.map((entry) => ({
        rewardName: entry.rewardName,
        rewardMint: entry.rewardMint ? new PublicKey(entry.rewardMint) : undefined,
        redemptionAmount: entry.redemptionAmount,
      }));

      const result = await removeRewardsBatch(batchParams);
      await handleTransactionResult(result, `Remove ${allEntries.length} Rewards`, resetForm);
    }
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

        {/* Fund Reward List */}
        <button
          onClick={() => openModal("fundRewardList")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Coins className="w-5 h-5 text-orange-400 group-hover:text-orange-300" />
          <span className="text-left">
            <div className="font-medium text-white">Fund Reward List</div>
            <div className="text-xs text-gray-400">Send SOL via sponsored lamports transfer</div>
          </span>
        </button>
      </div>

      {/* Fund Reward List Modal */}
      <TransactionModal
        isOpen={activeModal === "fundRewardList"}
        title="Fund Reward List"
        description="Send SOL to the reward list via a sponsored lamports transfer (ephemeral rollup)"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={localStatus.endpoint || connection.rpcEndpoint}
        onClose={closeModal}
        onConfirm={handleFundRewardList}
      >
        <div className="space-y-3">
          {!rewardList?.delegated && (
            <div className="bg-yellow-900 bg-opacity-30 border border-yellow-700 p-3 rounded text-sm">
              <p className="text-yellow-300 font-semibold">⚠️ Reward list is not delegated</p>
              <p className="text-yellow-400 text-xs mt-1">
                The reward list PDA must be delegated to the ephemeral rollup before you can
                fund it via a sponsored lamports transfer. Use &ldquo;Delegate Reward List&rdquo; first.
              </p>
            </div>
          )}

          {rewardListPda && (
            <div className="bg-gray-800 p-2 rounded text-xs">
              <p className="text-gray-400 mb-1">Destination (Reward List PDA)</p>
              <CopyableAddress address={rewardListPda.toBase58()} />
            </div>
          )}

          {/* SOL balance breakdown from the ER endpoint */}
          <div className="rounded border border-gray-700 bg-gray-900/60 p-3 text-xs">
            <p className="text-gray-300 font-medium mb-2">Current Balance (on ER)</p>
            {rewardListBalance?.loading ? (
              <p className="text-gray-500 italic">Fetching…</p>
            ) : rewardListBalance && rewardListBalance.totalLamports > 0 ? (
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total</span>
                  <span className="text-white font-mono">
                    {(rewardListBalance.totalLamports / 1e9).toFixed(9)} SOL
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Rent-free deposit</span>
                  <span className="text-gray-300 font-mono">
                    {(rewardListBalance.rentExemptLamports / 1e9).toFixed(9)} SOL
                  </span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
                  <span className="text-gray-400">Excess (usable for fees)</span>
                  <span className={`font-mono ${
                    rewardListBalance.totalLamports - rewardListBalance.rentExemptLamports > 0
                      ? "text-green-400"
                      : "text-yellow-400"
                  }`}>
                    {((rewardListBalance.totalLamports - rewardListBalance.rentExemptLamports) / 1e9).toFixed(9)} SOL
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-gray-500 italic">Account not found on ER — delegate the reward list first</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              Amount (SOL)
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={forms.fundRewardList.amountSol}
              onChange={(e) =>
                setForms((prev) => ({
                  ...prev,
                  fundRewardList: { amountSol: e.target.value },
                }))
              }
              placeholder="e.g. 0.1"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-orange-500 focus:outline-none disabled:opacity-50 text-sm"
            />
            {forms.fundRewardList.amountSol && !isNaN(parseFloat(forms.fundRewardList.amountSol)) && (
              <p className="text-xs text-gray-400 mt-1">
                = {Math.floor(parseFloat(forms.fundRewardList.amountSol) * 1_000_000_000).toLocaleString()} lamports
              </p>
            )}
          </div>

          <div className="bg-gray-800 p-2 rounded text-xs text-gray-400 space-y-1">
            <p>💡 This calls the e-token program&apos;s <code className="text-orange-300">SponsoredLamportsTransfer</code> instruction.</p>
            <p>A lamports PDA is created, funded, delegated, and a post-delegation action transfers the SOL to the reward list on the ER.</p>
            <p className="text-yellow-400">Setup fee: ~0.0003 SOL (sponsored rent, returned after completion)</p>
          </div>
        </div>
      </TransactionModal>

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
                {availableDistributorMints
                  .filter((option) => !option.isNftLike || (!alreadyAddedRewardMints.has(option.mint) && !batchRewards.some((b) => b.rewardMint === option.mint)))
                  .map((option) => (
                  <option key={option.tokenAccount} value={option.mint}>
                    {shortAddress(option.mint, 5)}{mintSymbols.get(option.mint) ? ` (${mintSymbols.get(option.mint)})` : ""} ({option.balanceLabel})
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

          {/* Add to Batch button */}
          <button
            type="button"
            onClick={handleAddToBatch}
            disabled={localStatus.loading || !forms.addReward.rewardName.trim() || !forms.addReward.rewardMint.trim()}
            className="w-full px-3 py-2 rounded-lg border border-dashed border-gray-500 text-gray-300 hover:bg-gray-700 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm"
          >
            + Add to Batch
          </button>

          {/* Batch Queue */}
          {batchRewards.length > 0 && (
            <div className="rounded border border-gray-700 bg-gray-900/60 p-3">
              <p className="mb-2 text-sm font-medium text-gray-200">
                Batched Rewards ({batchRewards.length})
              </p>
              <div className="space-y-1">
                {batchRewards.map((entry, index) => (
                  <div
                    key={`${entry.rewardName}-${entry.rewardMint}-${index}`}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-gray-300 truncate block">
                        {entry.rewardName} — {shortAddress(entry.rewardMint, 4)}{mintSymbols.get(entry.rewardMint) ? ` (${mintSymbols.get(entry.rewardMint)})` : ""}
                        {entry.isNftLike ? " (NFT)" : ` x${entry.rewardAmount}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setBatchRewards((prev) => prev.filter((_, i) => i !== index))
                      }
                      className="text-red-400 hover:text-red-300 flex-shrink-0"
                    >
                      ✕
                    </button>
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
              {availableRewardRemovalMints
                .filter((mint) => !batchRemoveRewards.some((b) => b.rewardMint === mint))
                .map((mint) => (
                <option key={mint} value={mint}>
                  {shortAddress(mint, 5)}{mintSymbols.get(mint) ? ` (${mintSymbols.get(mint)})` : ""}
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

          {/* Add to Batch button */}
          <button
            type="button"
            onClick={handleAddToRemoveBatch}
            disabled={localStatus.loading || !forms.removeReward.rewardName.trim() || !forms.removeReward.rewardMint.trim()}
            className="w-full px-3 py-2 rounded-lg border border-dashed border-gray-500 text-gray-300 hover:bg-gray-700 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm"
          >
            + Add to Batch
          </button>

          {/* Batch Queue */}
          {batchRemoveRewards.length > 0 && (
            <div className="rounded border border-gray-700 bg-gray-900/60 p-3">
              <p className="mb-2 text-sm font-medium text-gray-200">
                Batched Removals ({batchRemoveRewards.length})
              </p>
              <div className="space-y-1">
                {batchRemoveRewards.map((entry, index) => (
                  <div
                    key={`${entry.rewardName}-${entry.rewardMint}-${index}`}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-gray-300 truncate block">
                        {entry.rewardName} — {shortAddress(entry.rewardMint, 4)}{mintSymbols.get(entry.rewardMint) ? ` (${mintSymbols.get(entry.rewardMint)})` : ""} x{entry.redemptionAmount}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setBatchRemoveRewards((prev) => prev.filter((_, i) => i !== index))
                      }
                      className="text-red-400 hover:text-red-300 flex-shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gray-800 p-2 rounded text-xs text-gray-400">
            Select the reward and mint, then add to batch or confirm directly
          </div>
        </div>
      </TransactionModal>
    </div>
  );
};
