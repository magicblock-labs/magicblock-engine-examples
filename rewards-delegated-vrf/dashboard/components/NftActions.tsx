"use client";

import React, { useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import { Metadata } from "@metaplex-foundation/mpl-token-metadata";
import { Zap, Grid, Edit3, Send, ArrowRightLeft } from "lucide-react";
import { useTransaction } from "@/hooks/useTransaction";
import { useGlobalTransactionHistory } from "@/hooks/useGlobalTransactionHistory";
import { useRewardData } from "@/hooks/useRewardData";
import { getBaseLayerSolanaEndpoint, getDefaultSolanaEndpoint } from "@/lib/clusterContext";
import { requestDashboardDataRefresh } from "@/lib/refresh";
import { TransactionModal } from "./TransactionModal";
import { TokenActions } from "./TokenActions";
import { CopyableAddress } from "./CopyableAddress";
import { PDAs } from "@/lib/pda";
import { fetchOwnedSplMintOptions, type OwnedSplMintOption } from "@/lib/tokenAccounts";
import { shortAddress } from "@/lib/utils";

interface ActionForm {
  [key: string]: any;
}

interface NftActionsProps {
  selectedDistributor?: PublicKey | null;
}

interface CollectionOption {
  mint: string;
  name: string;
}

interface NftOption {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
}

export const NftActions: React.FC<NftActionsProps> = ({ selectedDistributor }) => {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const {
    mintNftCollection,
    mintNftToCollection,
    updateNftMetadata,
    adminTransfer,
    whitelistTransfer,
  } = useTransaction({ selectedDistributor });
  const { addTransaction, updateTransaction } = useGlobalTransactionHistory();

  // Distributor used for the admin_transfer flow — falls back to the wallet's
  // primary distributor when nothing is selected (mirrors AdminActions).
  const targetDistributor =
    selectedDistributor || (publicKey ? PDAs.getRewardDistributor(publicKey)[0] : null);
  const { rewardList } = useRewardData(publicKey, targetDistributor);

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState({
    loading: false,
    error: null as string | null,
    signature: null as string | null,
    endpoint: undefined as string | undefined,
  });
  const [forms, setForms] = useState<ActionForm>({
    mintCollection: {
      name: "",
      symbol: "",
      uri: "",
    },
    mintToCollection: {
      collectionMint: "",
      name: "",
      symbol: "",
      uri: "",
    },
    editMetadata: {
      mint: "",
      name: "",
      symbol: "",
      uri: "",
    },
    adminTransfer: {
      mint: "",
      user: "",
      amount: "",
    },
    whitelistTransfer: {
      mint: "",
      user: "",
      amount: "",
    },
  });

  // Whitelist distributor's SPL holdings — populated when the Whitelist
  // Transfer modal opens. Reads from the per-distributor PDA token accounts.
  const [whitelistMints, setWhitelistMints] = useState<OwnedSplMintOption[]>([]);
  const [whitelistMintsLoading, setWhitelistMintsLoading] = useState(false);
  const [whitelistMintsError, setWhitelistMintsError] = useState<string | null>(null);
  const whitelistDistributorPda = targetDistributor
    ? PDAs.getWhitelistDistributor(targetDistributor)[0]
    : null;

  // Distributor SPL holdings — populated when the Admin Transfer modal opens.
  const [distributorMints, setDistributorMints] = useState<OwnedSplMintOption[]>([]);
  const [distributorMintsLoading, setDistributorMintsLoading] = useState(false);
  const [distributorMintsError, setDistributorMintsError] = useState<string | null>(null);
  // Tracks which mint we've already auto-filled the amount for, so we don't
  // overwrite user edits while leaving the door open to refill on mint change.
  const [adminTransferAutofilledMint, setAdminTransferAutofilledMint] = useState<string | null>(null);
  const [availableCollections, setAvailableCollections] = useState<CollectionOption[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [collectionFetchError, setCollectionFetchError] = useState<string | null>(null);
  const [sendTokenOpen, setSendTokenOpen] = useState(false);
  const [availableNfts, setAvailableNfts] = useState<NftOption[]>([]);
  const [loadingNfts, setLoadingNfts] = useState(false);
  const [nftFetchError, setNftFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCollections = async () => {
      if (activeModal !== "mintToCollection" || !publicKey) {
        if (!cancelled) {
          setAvailableCollections([]);
          setLoadingCollections(false);
          setCollectionFetchError(null);
        }
        return;
      }

      setLoadingCollections(true);
      setCollectionFetchError(null);

      try {
        const readEndpoint = getBaseLayerSolanaEndpoint(connection.rpcEndpoint);
        const readConnection =
          readEndpoint === connection.rpcEndpoint
            ? connection
            : new Connection(readEndpoint, "confirmed");
        const metadataProgramId = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
        const programResponses = await Promise.all([
          readConnection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
          readConnection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
        ]);

        const nftMints = programResponses.flatMap((response) =>
          response.value.flatMap((accountInfo) => {
            try {
              const decodedAccount = unpackAccount(
                accountInfo.pubkey,
                accountInfo.account,
                accountInfo.account.owner
              );

              if (decodedAccount.amount !== 1n) {
                return [];
              }

              return [decodedAccount.mint];
            } catch {
              return [];
            }
          })
        );

        const uniqueMints = Array.from(new Set(nftMints.map((mint) => mint.toBase58()))).map(
          (mint) => new PublicKey(mint)
        );

        const metadataPdas = uniqueMints.map((mint) =>
          PublicKey.findProgramAddressSync(
            [
              Buffer.from("metadata"),
              metadataProgramId.toBuffer(),
              mint.toBuffer(),
            ],
            metadataProgramId
          )[0]
        );

        const metadataAccounts = metadataPdas.length > 0
          ? await readConnection.getMultipleAccountsInfo(metadataPdas)
          : [];

        const collectionOptions: CollectionOption[] = [];

        uniqueMints.forEach((mint, index) => {
          const metadataAccount = metadataAccounts[index];
          if (!metadataAccount) {
            return;
          }

          try {
            const [metadata] = Metadata.deserialize(metadataAccount.data);
            if (!metadata.collectionDetails) {
              return;
            }

            const metadataName =
              typeof metadata.data.name === "string"
                ? metadata.data.name.replace(/\0/g, "").trim()
                : mint.toBase58().slice(0, 8);

            collectionOptions.push({
              mint: mint.toBase58(),
              name: metadataName || mint.toBase58().slice(0, 8),
            });
          } catch {
            return;
          }
        });

        if (!cancelled) {
          setAvailableCollections(
            collectionOptions.sort((left, right) => left.name.localeCompare(right.name))
          );
        }
      } catch (error) {
        if (!cancelled) {
          setAvailableCollections([]);
          setCollectionFetchError(error instanceof Error ? error.message : "Unknown fetch error");
        }
      } finally {
        if (!cancelled) {
          setLoadingCollections(false);
        }
      }
    };

    void loadCollections();

    return () => {
      cancelled = true;
    };
  }, [activeModal, connection.rpcEndpoint, publicKey]);

  useEffect(() => {
    let cancelled = false;

    const loadNfts = async () => {
      if (activeModal !== "editMetadata" || !publicKey) {
        if (!cancelled) {
          setAvailableNfts([]);
          setLoadingNfts(false);
          setNftFetchError(null);
        }
        return;
      }

      setLoadingNfts(true);
      setNftFetchError(null);

      try {
        const readEndpoint = getBaseLayerSolanaEndpoint(connection.rpcEndpoint);
        const readConnection =
          readEndpoint === connection.rpcEndpoint
            ? connection
            : new Connection(readEndpoint, "confirmed");
        const metadataProgramId = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
        const programResponses = await Promise.all([
          readConnection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
          readConnection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
        ]);

        const nftMints = programResponses.flatMap((response) =>
          response.value.flatMap((accountInfo) => {
            try {
              const decodedAccount = unpackAccount(
                accountInfo.pubkey,
                accountInfo.account,
                accountInfo.account.owner
              );
              if (decodedAccount.amount !== 1n) {
                return [];
              }
              return [decodedAccount.mint];
            } catch {
              return [];
            }
          })
        );

        const uniqueMints = Array.from(new Set(nftMints.map((mint) => mint.toBase58()))).map(
          (mint) => new PublicKey(mint)
        );

        const metadataPdas = uniqueMints.map((mint) =>
          PublicKey.findProgramAddressSync(
            [Buffer.from("metadata"), metadataProgramId.toBuffer(), mint.toBuffer()],
            metadataProgramId
          )[0]
        );

        const metadataAccounts = metadataPdas.length > 0
          ? await readConnection.getMultipleAccountsInfo(metadataPdas)
          : [];

        const nftOptions: NftOption[] = [];

        uniqueMints.forEach((mint, index) => {
          const metadataAccount = metadataAccounts[index];
          if (!metadataAccount) return;

          try {
            const [metadata] = Metadata.deserialize(metadataAccount.data);
            const metadataName =
              typeof metadata.data.name === "string"
                ? metadata.data.name.replace(/\0/g, "").trim()
                : "";
            const metadataSymbol =
              typeof metadata.data.symbol === "string"
                ? metadata.data.symbol.replace(/\0/g, "").trim()
                : "";
            const metadataUri =
              typeof metadata.data.uri === "string"
                ? metadata.data.uri.replace(/\0/g, "").trim()
                : "";

            nftOptions.push({
              mint: mint.toBase58(),
              name: metadataName || mint.toBase58().slice(0, 8),
              symbol: metadataSymbol,
              uri: metadataUri,
            });
          } catch {
            return;
          }
        });

        if (!cancelled) {
          setAvailableNfts(nftOptions.sort((left, right) => left.name.localeCompare(right.name)));
        }
      } catch (error) {
        if (!cancelled) {
          setAvailableNfts([]);
          setNftFetchError(error instanceof Error ? error.message : "Unknown fetch error");
        }
      } finally {
        if (!cancelled) {
          setLoadingNfts(false);
        }
      }
    };

    void loadNfts();

    return () => {
      cancelled = true;
    };
  }, [activeModal, connection.rpcEndpoint, publicKey]);

  const handleMintCollection = async () => {
    setLocalStatus({ loading: true, error: null, signature: null, endpoint: undefined });
    const config = forms.mintCollection;
    const result = await mintNftCollection(config.name, config.symbol, config.uri);
    
    if ('signature' in result && result.signature) {
      const txId = addTransaction(
        result.signature,
        "Mint NFT Collection",
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
      setLocalStatus({ loading: false, error: null, signature: result.signature, endpoint: result.endpoint });
      setTimeout(() => {
        setActiveModal(null);
        setForms({
          ...forms,
          mintCollection: { name: "", symbol: "", uri: "" },
        });
        setLocalStatus({ loading: false, error: null, signature: null, endpoint: undefined });
      }, 2000);
    } else {
      setLocalStatus({ loading: false, error: result.error || "Unknown error", signature: null, endpoint: undefined });
    }
  };

  const handleMintToCollection = async () => {
    setLocalStatus({ loading: true, error: null, signature: null, endpoint: undefined });
    const config = forms.mintToCollection;

    if (!config.collectionMint.trim() || !config.name.trim() || !config.symbol.trim() || !config.uri.trim()) {
      setLocalStatus({
        loading: false,
        error: "Collection mint, NFT name, symbol, and metadata URI are required",
        signature: null,
        endpoint: undefined,
      });
      return;
    }

    let collectionMint: PublicKey;
    try {
      collectionMint = new PublicKey(config.collectionMint.trim());
    } catch {
      setLocalStatus({
        loading: false,
        error: "Collection mint is invalid",
        signature: null,
        endpoint: undefined,
      });
      return;
    }

    const result = await mintNftToCollection(
      collectionMint,
      config.name,
      config.symbol,
      config.uri
    );

    if ('signature' in result && result.signature) {
      const txId = addTransaction(
        result.signature,
        "Mint NFT to Collection",
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
      setLocalStatus({ loading: false, error: null, signature: result.signature, endpoint: result.endpoint });
    } else {
      setLocalStatus({ loading: false, error: result.error || "Unknown error", signature: null, endpoint: undefined });
    }
  };

  const handleMintToCollectionAgain = () => {
    setLocalStatus({ loading: false, error: null, signature: null, endpoint: undefined });
  };

  const handleEditMetadata = async () => {
    setLocalStatus({ loading: true, error: null, signature: null, endpoint: undefined });
    const config = forms.editMetadata;

    if (!config.mint.trim() || !config.name.trim() || !config.symbol.trim() || !config.uri.trim()) {
      setLocalStatus({
        loading: false,
        error: "NFT mint, name, symbol, and metadata URI are required",
        signature: null,
        endpoint: undefined,
      });
      return;
    }

    let mint: PublicKey;
    try {
      mint = new PublicKey(config.mint.trim());
    } catch {
      setLocalStatus({
        loading: false,
        error: "NFT mint address is invalid",
        signature: null,
        endpoint: undefined,
      });
      return;
    }

    const result = await updateNftMetadata(mint, config.name, config.symbol, config.uri);

    if ('signature' in result && result.signature) {
      const txId = addTransaction(
        result.signature,
        "Update NFT Metadata",
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
      setLocalStatus({ loading: false, error: null, signature: result.signature, endpoint: result.endpoint });
      setTimeout(() => {
        setActiveModal(null);
        setForms({
          ...forms,
          editMetadata: { mint: "", name: "", symbol: "", uri: "" },
        });
        setLocalStatus({ loading: false, error: null, signature: null, endpoint: undefined });
      }, 2000);
    } else {
      setLocalStatus({ loading: false, error: result.error || "Unknown error", signature: null, endpoint: undefined });
    }
  };

  // Fetch the whitelist distributor's SPL mints when the Whitelist Transfer
  // modal opens. Reads from the base layer — the whitelist_distributor PDA
  // holds tokens directly (no ER delegation).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (activeModal !== "whitelistTransfer" || !whitelistDistributorPda) {
        setWhitelistMints([]);
        setWhitelistMintsError(null);
        setWhitelistMintsLoading(false);
        return;
      }
      setWhitelistMintsLoading(true);
      setWhitelistMintsError(null);
      try {
        const readEndpoint = getBaseLayerSolanaEndpoint(connection.rpcEndpoint);
        const readConnection =
          readEndpoint === connection.rpcEndpoint
            ? connection
            : new Connection(readEndpoint, "confirmed");
        const result = await fetchOwnedSplMintOptions(
          readConnection,
          whitelistDistributorPda
        );
        if (!cancelled) setWhitelistMints(result.options);
      } catch (error) {
        if (!cancelled) {
          setWhitelistMints([]);
          setWhitelistMintsError(
            error instanceof Error ? error.message : "Unknown fetch error"
          );
        }
      } finally {
        if (!cancelled) setWhitelistMintsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeModal, whitelistDistributorPda?.toBase58(), connection.rpcEndpoint]);

  const handleWhitelistTransfer = async () => {
    if (!targetDistributor) {
      setLocalStatus({ loading: false, error: "No distributor selected", signature: null, endpoint: undefined });
      return;
    }
    const cfg = forms.whitelistTransfer;
    if (!cfg.mint) {
      setLocalStatus({ loading: false, error: "Select a mint", signature: null, endpoint: undefined });
      return;
    }
    if (!cfg.user.trim()) {
      setLocalStatus({ loading: false, error: "Enter a recipient pubkey", signature: null, endpoint: undefined });
      return;
    }
    let userPk: PublicKey;
    try {
      userPk = new PublicKey(cfg.user.trim());
    } catch {
      setLocalStatus({ loading: false, error: "Invalid recipient pubkey", signature: null, endpoint: undefined });
      return;
    }
    const amount = parseFloat(cfg.amount);
    if (isNaN(amount) || amount <= 0) {
      setLocalStatus({ loading: false, error: "Enter a valid amount", signature: null, endpoint: undefined });
      return;
    }

    setLocalStatus({ loading: true, error: null, signature: null, endpoint: undefined });
    const result = await whitelistTransfer(new PublicKey(cfg.mint), userPk, amount);

    if ("signature" in result && result.signature) {
      const txId = addTransaction(
        result.signature,
        "Whitelist Transfer",
        "devnet",
        result.endpoint || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || getDefaultSolanaEndpoint()
      );
      updateTransaction(txId, {
        status: result.success ? "confirmed" : "failed",
        error: result.error,
      });
      if (result.success) requestDashboardDataRefresh();
      setLocalStatus({ loading: false, error: null, signature: result.signature, endpoint: result.endpoint });
      setTimeout(() => {
        setActiveModal(null);
        setForms((prev) => ({
          ...prev,
          whitelistTransfer: { mint: "", user: "", amount: "" },
        }));
        setLocalStatus({ loading: false, error: null, signature: null, endpoint: undefined });
      }, 2000);
    } else {
      setLocalStatus({
        loading: false,
        error: result.error || "Unknown error",
        signature: null,
        endpoint: undefined,
      });
    }
  };

  // Fetch distributor's SPL mints when the Admin Transfer modal opens.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (activeModal !== "adminTransfer" || !targetDistributor) {
        setDistributorMints([]);
        setDistributorMintsError(null);
        setDistributorMintsLoading(false);
        return;
      }
      setDistributorMintsLoading(true);
      setDistributorMintsError(null);
      try {
        // Distributor's token accounts live on base — use the base-layer endpoint.
        const readEndpoint = getBaseLayerSolanaEndpoint(connection.rpcEndpoint);
        const readConnection =
          readEndpoint === connection.rpcEndpoint
            ? connection
            : new Connection(readEndpoint, "confirmed");
        const result = await fetchOwnedSplMintOptions(readConnection, targetDistributor);
        if (!cancelled) setDistributorMints(result.options);
      } catch (error) {
        if (!cancelled) {
          setDistributorMints([]);
          setDistributorMintsError(
            error instanceof Error ? error.message : "Unknown fetch error"
          );
        }
      } finally {
        if (!cancelled) setDistributorMintsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeModal, targetDistributor?.toBase58(), connection.rpcEndpoint]);

  // Per-mint availability computation. Mirrors the on-chain check
  // `available = total - committed`, where
  // `committed = sum over reward_list of (remaining * reward_amount)` for
  // rewards using this mint (in base units).
  const computeMintAvailability = (opt: OwnedSplMintOption) => {
    const decimals = opt.decimals ?? 0;
    const multiplier = Math.pow(10, decimals);
    // opt.balanceLabel is the UI-unit display; raw amount isn't exposed by
    // the option type, so reconstruct from balanceLabel * multiplier.
    const totalBaseUnits = Math.floor((parseFloat(opt.balanceLabel) || 0) * multiplier);
    const committedBaseUnits = (rewardList?.rewards ?? []).reduce(
      (sum: number, r: any) => {
        const mints: string[] = (r.rewardMints ?? []).map((m: any) => m?.toString?.());
        if (!mints.includes(opt.mint)) return sum;
        const remaining = Math.max(
          0,
          Number(r.redemptionLimit) - Number(r.redemptionCount)
        );
        const amount = Number(r.rewardAmount) * multiplier;
        return sum + remaining * amount;
      },
      0
    );
    const availableBaseUnits = Math.max(0, totalBaseUnits - committedBaseUnits);
    return {
      decimals,
      totalUi: totalBaseUnits / multiplier,
      committedUi: committedBaseUnits / multiplier,
      availableUi: availableBaseUnits / multiplier,
    };
  };

  // Mints with non-zero transferable balance — the only ones we surface in
  // the Admin Transfer dropdown.
  const transferableMints = distributorMints
    .map((opt) => ({ opt, availability: computeMintAvailability(opt) }))
    .filter((entry) => entry.availability.availableUi > 0);

  // Preview for the currently selected mint, derived from the same helper.
  const adminTransferPreview = (() => {
    const mintStr = forms.adminTransfer.mint;
    if (!mintStr) return null;
    const opt = distributorMints.find((m) => m.mint === mintStr);
    if (!opt) return null;
    return computeMintAvailability(opt);
  })();

  // Auto-fill the amount with the available-to-transfer value once per mint
  // selection. Won't overwrite later user edits (we track which mint we've
  // already filled). Reset when the modal closes so reopening starts fresh.
  useEffect(() => {
    if (activeModal !== "adminTransfer") {
      if (adminTransferAutofilledMint !== null) {
        setAdminTransferAutofilledMint(null);
      }
      return;
    }
    const mint = forms.adminTransfer.mint;
    const available = adminTransferPreview?.availableUi;
    if (!mint || available == null) return;
    if (mint === adminTransferAutofilledMint) return;
    setForms((prev) => ({
      ...prev,
      adminTransfer: { ...prev.adminTransfer, amount: String(available) },
    }));
    setAdminTransferAutofilledMint(mint);
  }, [
    activeModal,
    forms.adminTransfer.mint,
    adminTransferPreview?.availableUi,
    adminTransferAutofilledMint,
  ]);

  const handleAdminTransfer = async () => {
    if (!targetDistributor) {
      setLocalStatus({ loading: false, error: "No distributor selected", signature: null, endpoint: undefined });
      return;
    }
    const cfg = forms.adminTransfer;
    if (!cfg.mint) {
      setLocalStatus({ loading: false, error: "Select a mint", signature: null, endpoint: undefined });
      return;
    }
    if (!cfg.user.trim()) {
      setLocalStatus({ loading: false, error: "Enter a recipient pubkey", signature: null, endpoint: undefined });
      return;
    }
    let userPk: PublicKey;
    try {
      userPk = new PublicKey(cfg.user.trim());
    } catch {
      setLocalStatus({ loading: false, error: "Invalid recipient pubkey", signature: null, endpoint: undefined });
      return;
    }
    const amount = parseFloat(cfg.amount);
    if (isNaN(amount) || amount <= 0) {
      setLocalStatus({ loading: false, error: "Enter a valid amount", signature: null, endpoint: undefined });
      return;
    }

    setLocalStatus({ loading: true, error: null, signature: null, endpoint: undefined });
    const result = await adminTransfer(new PublicKey(cfg.mint), userPk, amount);

    if ("signature" in result && result.signature) {
      const txId = addTransaction(
        result.signature,
        "Admin Transfer",
        "devnet",
        result.endpoint || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || getDefaultSolanaEndpoint()
      );
      updateTransaction(txId, {
        status: result.success ? "confirmed" : "failed",
        error: result.error,
      });
      if (result.success) requestDashboardDataRefresh();
      setLocalStatus({ loading: false, error: null, signature: result.signature, endpoint: result.endpoint });
      setTimeout(() => {
        setActiveModal(null);
        setForms((prev) => ({
          ...prev,
          adminTransfer: { mint: "", user: "", amount: "" },
        }));
        setLocalStatus({ loading: false, error: null, signature: null, endpoint: undefined });
      }, 2000);
    } else {
      setLocalStatus({
        loading: false,
        error: result.error || "Unknown error",
        signature: null,
        endpoint: undefined,
      });
    }
  };

  if (!publicKey) {
    return (
      <div className="card p-8 text-center">
        <p className="text-gray-400">Connect your wallet to access NFT actions</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-white mb-4">Token / NFT Management</h2>

      {/* Action Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Mint NFT Collection */}
        <button
          onClick={() => setActiveModal("mintCollection")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Grid className="w-5 h-5 text-cyan-400 group-hover:text-cyan-300" />
          <span className="text-left">
            <div className="font-medium text-white">Mint NFT Collection</div>
            <div className="text-xs text-gray-400">Create a new NFT collection</div>
          </span>
        </button>

        {/* Mint NFT to Collection */}
        <button
          onClick={() => setActiveModal("mintToCollection")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Zap className="w-5 h-5 text-pink-400 group-hover:text-pink-300" />
          <span className="text-left">
            <div className="font-medium text-white">Mint NFT to Collection</div>
            <div className="text-xs text-gray-400">Create new NFT in collection</div>
          </span>
        </button>

        {/* Edit NFT Metadata */}
        <button
          onClick={() => setActiveModal("editMetadata")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Edit3 className="w-5 h-5 text-yellow-400 group-hover:text-yellow-300" />
          <span className="text-left">
            <div className="font-medium text-white">Edit NFT Metadata</div>
            <div className="text-xs text-gray-400">Update name, symbol, or URI</div>
          </span>
        </button>

        {/* Send SPL Token */}
        <button
          onClick={() => setSendTokenOpen(true)}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <Send className="w-5 h-5 text-blue-400 group-hover:text-blue-300" />
          <span className="text-left">
            <div className="font-medium text-white">Send SPL Token</div>
            <div className="text-xs text-gray-400">Transfer tokens to distributor</div>
          </span>
        </button>

        {/* Admin Transfer (distributor → user, ER-scheduled, availability-checked) */}
        <button
          onClick={() => setActiveModal("adminTransfer")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <ArrowRightLeft className="w-5 h-5 text-emerald-400 group-hover:text-emerald-300" />
          <span className="text-left">
            <div className="font-medium text-white">Admin Transfer</div>
            <div className="text-xs text-gray-400">Send distributor assets to a user (non-VRF)</div>
          </span>
        </button>

        {/* Whitelist Transfer (whitelist_distributor → user, base layer) */}
        <button
          onClick={() => setActiveModal("whitelistTransfer")}
          className="card p-4 hover:bg-gray-700 transition flex items-center gap-3 group"
        >
          <ArrowRightLeft className="w-5 h-5 text-purple-400 group-hover:text-purple-300" />
          <span className="text-left">
            <div className="font-medium text-white">Whitelist Transfer</div>
            <div className="text-xs text-gray-400">Move tokens from the whitelist bag to a user</div>
          </span>
        </button>
      </div>

      {/* Mint Collection Modal */}
      <TransactionModal
        isOpen={activeModal === "mintCollection"}
        title="Mint NFT Collection"
        description="Create a new NFT collection"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={localStatus.endpoint}
        onClose={() => setActiveModal(null)}
        onConfirm={handleMintCollection}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Collection Name</label>
            <input
              type="text"
              value={forms.mintCollection.name}
              onChange={(e) =>
                setForms({
                  ...forms,
                  mintCollection: { ...forms.mintCollection, name: e.target.value },
                })
              }
              placeholder="e.g., My NFT Collection"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
              </div>
              <div>
              <label className="block text-sm text-gray-300 mb-1">Symbol</label>
              <input
               type="text"
               value={forms.mintCollection.symbol}
               onChange={(e) =>
                 setForms({
                   ...forms,
                   mintCollection: { ...forms.mintCollection, symbol: e.target.value },
                 })
               }
               placeholder="e.g., MYNFT"
               disabled={localStatus.loading}
               className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
              </div>
              <div>
              <label className="block text-sm text-gray-300 mb-1">Metadata URI</label>
              <input
               type="text"
               value={forms.mintCollection.uri}
               onChange={(e) =>
                 setForms({
                   ...forms,
                   mintCollection: { ...forms.mintCollection, uri: e.target.value },
                 })
               }
               placeholder="e.g., https://example.com/collection.json"
               disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
            />
          </div>
        </div>
      </TransactionModal>

      {/* Mint to Collection Modal */}
      <TransactionModal
        isOpen={activeModal === "mintToCollection"}
        title="Mint NFT to Collection"
        description="Create a new NFT in the collection"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={localStatus.endpoint}
        onClose={() => setActiveModal(null)}
        onConfirm={handleMintToCollection}
        onMintAgain={handleMintToCollectionAgain}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Collection Mint</label>
            {collectionFetchError && (
              <div className="mt-2 rounded border border-red-700 bg-red-900/20 p-2 text-xs text-red-300">
                Fetch error: {collectionFetchError}
              </div>
            )}
            <select
              value={forms.mintToCollection.collectionMint}
              onChange={(e) =>
                setForms({
                  ...forms,
                  mintToCollection: { ...forms.mintToCollection, collectionMint: e.target.value },
                })
              }
              disabled={localStatus.loading || loadingCollections || availableCollections.length === 0}
              className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
            >
              <option value="">
                {loadingCollections
                  ? "Loading collection NFTs..."
                  : availableCollections.length > 0
                    ? "Select collection mint"
                    : "No collection NFTs found"}
              </option>
              {availableCollections.map((collection) => (
                <option key={collection.mint} value={collection.mint}>
                  {collection.name} ({shortAddress(collection.mint, 5)})
                </option>
              ))}
            </select>
          </div>
              <div>
              <label className="block text-sm text-gray-300 mb-1">NFT Name</label>
              <input
               type="text"
               value={forms.mintToCollection.name}
               onChange={(e) =>
                 setForms({
                   ...forms,
                   mintToCollection: { ...forms.mintToCollection, name: e.target.value },
                 })
               }
               placeholder="e.g., NFT #1"
               disabled={localStatus.loading}
               className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
              </div>
              <div>
              <label className="block text-sm text-gray-300 mb-1">Symbol</label>
              <input
               type="text"
               value={forms.mintToCollection.symbol}
               onChange={(e) =>
                 setForms({
                   ...forms,
                   mintToCollection: { ...forms.mintToCollection, symbol: e.target.value },
                 })
               }
               placeholder="e.g., MYNFT"
               disabled={localStatus.loading}
               className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
              </div>
              <div>
              <label className="block text-sm text-gray-300 mb-1">Metadata URI</label>
              <input
               type="text"
               value={forms.mintToCollection.uri}
               onChange={(e) =>
                 setForms({
                   ...forms,
                   mintToCollection: { ...forms.mintToCollection, uri: e.target.value },
                 })
               }
               placeholder="e.g., https://example.com/nft.json"
               disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
            />
          </div>
        </div>
      </TransactionModal>

      {/* Edit NFT Metadata Modal */}
      <TransactionModal
        isOpen={activeModal === "editMetadata"}
        title="Edit NFT Metadata"
        description="Update name, symbol, or URI of an NFT"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={localStatus.endpoint}
        onClose={() => setActiveModal(null)}
        onConfirm={handleEditMetadata}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1">NFT</label>
            {nftFetchError && (
              <div className="mt-2 rounded border border-red-700 bg-red-900/20 p-2 text-xs text-red-300">
                Fetch error: {nftFetchError}
              </div>
            )}
            <select
              value={forms.editMetadata.mint}
              onChange={(e) => {
                const selectedNft = availableNfts.find((nft) => nft.mint === e.target.value);
                setForms({
                  ...forms,
                  editMetadata: {
                    mint: e.target.value,
                    name: selectedNft?.name || "",
                    symbol: selectedNft?.symbol || "",
                    uri: selectedNft?.uri || "",
                  },
                });
              }}
              disabled={localStatus.loading || loadingNfts || availableNfts.length === 0}
              className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
            >
              <option value="">
                {loadingNfts
                  ? "Loading NFTs..."
                  : availableNfts.length > 0
                    ? "Select NFT"
                    : "No NFTs found"}
              </option>
              {availableNfts.map((nft) => (
                <option key={nft.mint} value={nft.mint}>
                  {nft.name} ({shortAddress(nft.mint, 5)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Name</label>
            <input
              type="text"
              value={forms.editMetadata.name}
              onChange={(e) =>
                setForms({
                  ...forms,
                  editMetadata: { ...forms.editMetadata, name: e.target.value },
                })
              }
              placeholder="e.g., My NFT"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Symbol</label>
            <input
              type="text"
              value={forms.editMetadata.symbol}
              onChange={(e) =>
                setForms({
                  ...forms,
                  editMetadata: { ...forms.editMetadata, symbol: e.target.value },
                })
              }
              placeholder="e.g., MYNFT"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Metadata URI</label>
            <input
              type="text"
              value={forms.editMetadata.uri}
              onChange={(e) =>
                setForms({
                  ...forms,
                  editMetadata: { ...forms.editMetadata, uri: e.target.value },
                })
              }
              placeholder="e.g., https://example.com/nft.json"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
            />
          </div>
        </div>
      </TransactionModal>

      {/* Admin Transfer Modal — ER-scheduled, on-chain availability check */}
      <TransactionModal
        isOpen={activeModal === "adminTransfer"}
        title="Admin Transfer"
        description="Send distributor-held assets to a user, outside the VRF flow. Runs on the ER; the on-chain check prevents draining assets committed to outstanding redemptions."
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={localStatus.endpoint}
        onClose={() => setActiveModal(null)}
        onConfirm={handleAdminTransfer}
      >
        <div className="space-y-3">
          {targetDistributor && (
            <div className="bg-gray-800 p-2 rounded text-xs">
              <p className="text-gray-400 mb-1">Source (Reward Distributor PDA)</p>
              <CopyableAddress address={targetDistributor.toBase58()} />
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-300 mb-1">Mint</label>
            {distributorMintsError && (
              <div className="mt-2 rounded border border-red-700 bg-red-900/20 p-2 text-xs text-red-300">
                Fetch error: {distributorMintsError}
              </div>
            )}
            <select
              value={forms.adminTransfer.mint}
              onChange={(e) =>
                setForms({
                  ...forms,
                  adminTransfer: { ...forms.adminTransfer, mint: e.target.value },
                })
              }
              disabled={localStatus.loading || distributorMintsLoading || transferableMints.length === 0}
              className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-emerald-500 focus:outline-none disabled:opacity-50 text-sm"
            >
              <option value="">
                {distributorMintsLoading
                  ? "Loading distributor mints..."
                  : transferableMints.length > 0
                    ? "Select a mint with available balance"
                    : distributorMints.length > 0
                      ? "All mints fully committed to redemptions"
                      : "Distributor holds no SPL tokens"}
              </option>
              {transferableMints.map(({ opt, availability }) => (
                <option key={opt.tokenAccount} value={opt.mint}>
                  {shortAddress(opt.mint, 5)} (available: {availability.availableUi})
                </option>
              ))}
            </select>
          </div>

          {adminTransferPreview && (
            <div className="rounded border border-gray-700 bg-gray-900/60 p-3 text-xs">
              <p className="text-gray-300 font-medium mb-2">Availability (base layer)</p>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total held</span>
                  <span className="text-white font-mono">{adminTransferPreview.totalUi}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Committed to redemptions</span>
                  <span className="text-gray-300 font-mono">{adminTransferPreview.committedUi}</span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
                  <span className="text-gray-400">Available to transfer</span>
                  <span
                    className={`font-mono ${
                      adminTransferPreview.availableUi > 0 ? "text-green-400" : "text-yellow-400"
                    }`}
                  >
                    {adminTransferPreview.availableUi}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-300 mb-1">Recipient (pubkey)</label>
            <input
              type="text"
              value={forms.adminTransfer.user}
              onChange={(e) =>
                setForms({
                  ...forms,
                  adminTransfer: { ...forms.adminTransfer, user: e.target.value },
                })
              }
              placeholder="e.g. 7xKXt..."
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-emerald-500 focus:outline-none disabled:opacity-50 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">Amount (UI units)</label>
            <input
              type="number"
              step="any"
              min="0"
              value={forms.adminTransfer.amount}
              onChange={(e) =>
                setForms({
                  ...forms,
                  adminTransfer: { ...forms.adminTransfer, amount: e.target.value },
                })
              }
              placeholder={adminTransferPreview ? `up to ${adminTransferPreview.availableUi}` : "e.g. 100"}
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-emerald-500 focus:outline-none disabled:opacity-50 text-sm"
            />
          </div>

          <div className="bg-gray-800 p-2 rounded text-xs text-gray-400 space-y-1">
            <p>💡 Submitted on the ER endpoint. The on-chain handler reads the delegated <code className="text-emerald-300">reward_list</code> to compute committed amounts and rejects the tx if the transfer would dip into reserved assets.</p>
            <p>Reward redemption counts are <strong>not</strong> changed by this action.</p>
          </div>
        </div>
      </TransactionModal>

      {/* Whitelist Transfer Modal — moves tokens out of the per-distributor
          whitelist_distributor PDA on the base layer. Signer must be admin/
          super_admin or in `reward_distributor.whitelist`. */}
      <TransactionModal
        isOpen={activeModal === "whitelistTransfer"}
        title="Whitelist Transfer"
        description="Move SPL tokens out of the whitelist_distributor PDA to a user. Signer must be admin, super_admin, or a whitelist member."
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
        endpoint={localStatus.endpoint}
        onClose={() => setActiveModal(null)}
        onConfirm={handleWhitelistTransfer}
      >
        <div className="space-y-3">
          {whitelistDistributorPda && (
            <div className="bg-gray-800 p-2 rounded text-xs">
              <p className="text-gray-400 mb-1">Source (Whitelist Distributor PDA)</p>
              <CopyableAddress address={whitelistDistributorPda.toBase58()} />
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-300 mb-1">Mint</label>
            {whitelistMintsError && (
              <div className="mt-2 rounded border border-red-700 bg-red-900/20 p-2 text-xs text-red-300">
                Fetch error: {whitelistMintsError}
              </div>
            )}
            <select
              value={forms.whitelistTransfer.mint}
              onChange={(e) =>
                setForms({
                  ...forms,
                  whitelistTransfer: {
                    ...forms.whitelistTransfer,
                    mint: e.target.value,
                  },
                })
              }
              disabled={
                localStatus.loading ||
                whitelistMintsLoading ||
                whitelistMints.length === 0
              }
              className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-purple-500 focus:outline-none disabled:opacity-50 text-sm"
            >
              <option value="">
                {whitelistMintsLoading
                  ? "Loading whitelist mints..."
                  : whitelistMints.length > 0
                    ? "Select a mint"
                    : "Whitelist bag holds no SPL tokens"}
              </option>
              {whitelistMints.map((opt) => (
                <option key={opt.tokenAccount} value={opt.mint}>
                  {shortAddress(opt.mint, 5)} ({opt.balanceLabel})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">Recipient (pubkey)</label>
            <input
              type="text"
              value={forms.whitelistTransfer.user}
              onChange={(e) =>
                setForms({
                  ...forms,
                  whitelistTransfer: {
                    ...forms.whitelistTransfer,
                    user: e.target.value,
                  },
                })
              }
              placeholder="e.g. 7xKXt..."
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-purple-500 focus:outline-none disabled:opacity-50 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">Amount (UI units)</label>
            <input
              type="number"
              step="any"
              min="0"
              value={forms.whitelistTransfer.amount}
              onChange={(e) =>
                setForms({
                  ...forms,
                  whitelistTransfer: {
                    ...forms.whitelistTransfer,
                    amount: e.target.value,
                  },
                })
              }
              placeholder="e.g. 100"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-purple-500 focus:outline-none disabled:opacity-50 text-sm"
            />
          </div>

          <div className="bg-gray-800 p-2 rounded text-xs text-gray-400 space-y-1">
            <p>💡 Submitted on the ER endpoint. The on-chain handler signs the SPL CPI with the whitelist_distributor PDA's seeds; reward_list must be delegated so the Magic intent can be paid for from the rollup.</p>
            <p>Reward inventory checks do <strong>not</strong> apply — the whitelist bag is intentionally separate from the reward distributor's main token holdings.</p>
          </div>
        </div>
      </TransactionModal>

      <TokenActions
        selectedDistributor={selectedDistributor}
        externalOpen={sendTokenOpen}
        onExternalClose={() => setSendTokenOpen(false)}
      />
    </div>
  );
};
