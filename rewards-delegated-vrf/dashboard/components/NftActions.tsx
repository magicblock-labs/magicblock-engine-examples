"use client";

import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Zap, Grid } from "lucide-react";
import { useTransaction } from "@/hooks/useTransaction";
import { useGlobalTransactionHistory } from "@/hooks/useGlobalTransactionHistory";
import { getDefaultSolanaEndpoint } from "@/lib/clusterContext";
import { TransactionModal } from "./TransactionModal";

interface ActionForm {
  [key: string]: any;
}

export const NftActions: React.FC = () => {
  const { publicKey } = useWallet();
  const { status, mintNftCollection } = useTransaction();
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

  const handleMintCollection = async () => {
    setLocalStatus({ loading: true, error: null, signature: null });
    const config = forms.mintCollection;
    const result = await mintNftCollection(config.name, config.symbol, config.uri, 0);
    
    if (result.signature) {
      const txId = addTransaction(
        result.signature,
        "Mint NFT Collection",
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
          mintCollection: { name: "", symbol: "", uri: "" },
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
      <h2 className="text-2xl font-bold text-white mb-4">NFT Management</h2>

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
        onConfirm={async () => {
          // Implementation for minting to collection
          console.log("Mint to collection not yet implemented");
        }}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Collection Mint Address</label>
            <input
              type="text"
              value={forms.mintToCollection.collectionMint}
              onChange={(e) =>
                setForms({
                  ...forms,
                  mintToCollection: { ...forms.mintToCollection, collectionMint: e.target.value },
                })
              }
              placeholder="Enter collection mint address"
              disabled={localStatus.loading}
              className="w-full p-2 bg-gray-700 text-white placeholder-gray-500 rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
              />
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
    </div>
  );
};
