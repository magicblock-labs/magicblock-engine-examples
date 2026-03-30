"use client";

import React, { useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import { getMetadataAccountDataSerializer } from "@metaplex-foundation/mpl-token-metadata";
import { Zap, Grid } from "lucide-react";
import { useTransaction } from "@/hooks/useTransaction";
import { useGlobalTransactionHistory } from "@/hooks/useGlobalTransactionHistory";
import { getBaseLayerSolanaEndpoint, getDefaultSolanaEndpoint } from "@/lib/clusterContext";
import { requestDashboardDataRefresh } from "@/lib/refresh";
import { TransactionModal } from "./TransactionModal";
import { TokenActions } from "./TokenActions";
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

export const NftActions: React.FC<NftActionsProps> = ({ selectedDistributor }) => {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { mintNftCollection, mintNftToCollection } = useTransaction();
  const { addTransaction, updateTransaction } = useGlobalTransactionHistory();

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState({
    loading: false,
    error: null as string | null,
    signature: null as string | null,
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
  });
  const [availableCollections, setAvailableCollections] = useState<CollectionOption[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [collectionFetchError, setCollectionFetchError] = useState<string | null>(null);

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
        const serializer = getMetadataAccountDataSerializer();
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
            const [metadata] = serializer.deserialize(metadataAccount.data);
            if (!metadata.collectionDetails) {
              return;
            }

            const metadataName =
              typeof metadata.name === "string"
                ? metadata.name.replace(/\0/g, "").trim()
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

  const handleMintCollection = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const config = forms.mintCollection;
    const result = await mintNftCollection(config.name, config.symbol, config.uri, 0);
    
    if (result.signature) {
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
      setLocalStatus({ loading: false, error: null, signature: result.signature });
      setTimeout(() => {
        setActiveModal(null);
        setForms({
          ...forms,
          mintCollection: { name: "", symbol: "", uri: "" },
        });
        setLocalStatus({ loading: false, error: null, signature: null });
      }, 2000);
    } else {
      setLocalStatus({ loading: false, error: result.error || "Unknown error", signature: null });
    }
  };

  const handleMintToCollection = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const config = forms.mintToCollection;

    if (!config.collectionMint.trim() || !config.name.trim() || !config.symbol.trim() || !config.uri.trim()) {
      setLocalStatus({
        loading: false,
        error: "Collection mint, NFT name, symbol, and metadata URI are required",
        signature: null,
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
      });
      return;
    }

    const result = await mintNftToCollection(
      collectionMint,
      config.name,
      config.symbol,
      config.uri
    );

    if (result.signature) {
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
      setLocalStatus({ loading: false, error: null, signature: result.signature });
      setTimeout(() => {
        setActiveModal(null);
        setForms({
          ...forms,
          mintToCollection: { collectionMint: "", name: "", symbol: "", uri: "" },
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
      </div>

      {/* Mint Collection Modal */}
      <TransactionModal
        isOpen={activeModal === "mintCollection"}
        title="Mint NFT Collection"
        description="Create a new NFT collection"
        loading={localStatus.loading}
        error={localStatus.error}
        signature={localStatus.signature}
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
        onClose={() => setActiveModal(null)}
        onConfirm={handleMintToCollection}
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

      <TokenActions selectedDistributor={selectedDistributor} showTitle={false} />
    </div>
  );
};
