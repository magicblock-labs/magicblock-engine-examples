"use client";

import React, { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  Header,
  WalletInfo,
  DistributorCard,
  RewardListCard,
  RewardsTable,
  LoadingSpinner,
  ErrorMessage,
  AdminActions,
  DelegationActions,
} from "@/components";
import { NftActions } from "@/components/NftActions";
import { TransactionHistory } from "@/components/TransactionHistory";
import { DistributorSwitcher } from "@/components/DistributorSwitcher";
import { useRewardData } from "@/hooks/useRewardData";
import { useGlobalTransactionHistory } from "@/hooks/useGlobalTransactionHistory";
import { useDiscoverDistributors } from "@/hooks/useDiscoverDistributors";
import { PDAs } from "@/lib/pda";
import { RefreshCw } from "lucide-react";

export default function Home() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [dismissedError, setDismissedError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [selectedDistributor, setSelectedDistributor] = useState<string | null>(null);
  const { distributors } = useDiscoverDistributors(publicKey);
  
  const { distributor, rewardList, loading, error, refetch } = useRewardData(
    publicKey,
    selectedDistributor ? new PublicKey(selectedDistributor) : null
  );
  const { transactions, removeTransaction } = useGlobalTransactionHistory();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Clear selected distributor when network changes
  useEffect(() => {
    setSelectedDistributor(null);
  }, [connection.rpcEndpoint]);

  // Auto-select first discovered distributor
  useEffect(() => {
    if (publicKey && !selectedDistributor && distributors.length > 0) {
      setSelectedDistributor(distributors[0].publicKey.toString());
    }
  }, [publicKey, distributors, selectedDistributor]);

  const distributorPda = selectedDistributor 
    ? new PublicKey(selectedDistributor)
    : publicKey ? PDAs.getRewardDistributor(publicKey)[0] : null;

  // Don't render wallet-dependent content until mounted
  if (!mounted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Header />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <LoadingSpinner />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Header />

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* Wallet Status */}
        <WalletInfo />

        {/* Distributor Switcher */}
        {publicKey && (
          <DistributorSwitcher
            selectedDistributor={selectedDistributor ? new PublicKey(selectedDistributor) : null}
            onSelectDistributor={(dist) => setSelectedDistributor(dist.toString())}
          />
        )}

        {/* Error Message */}
        {error && !dismissedError && (
          <ErrorMessage
            message={error}
            onDismiss={() => setDismissedError(true)}
          />
        )}

        {/* Your Distributor Section */}
        {publicKey && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-white">
                Your Reward Distributor
              </h2>
              <button
                onClick={() => {
                  refetch();
                  setDismissedError(false);
                }}
                disabled={loading}
                className="inline-flex items-center gap-2 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw
                  className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </button>
            </div>

            {loading && <LoadingSpinner />}

            {!loading && distributor && (
              <div className="space-y-4">
                <DistributorCard
                  distributor={distributor}
                  address={distributorPda?.toString() || ""}
                />
                {rewardList && (
                  <>
                    <RewardListCard rewardList={rewardList} />
                    <RewardsTable rewards={rewardList.rewards} />
                  </>
                )}
              </div>
            )}

            {!loading && !distributor && !error && (
              <div className="card text-center py-8">
                <p className="text-gray-400">
                  No reward distributor found. Initialize one first using the program.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Admin Actions Section */}
        {publicKey && (
          <div className="pt-8 border-t border-gray-700">
            <AdminActions selectedDistributor={selectedDistributor ? new PublicKey(selectedDistributor) : null} />
          </div>
        )}

        {publicKey && (
          <div className="pt-8 border-t border-gray-700">
            <DelegationActions selectedDistributor={selectedDistributor ? new PublicKey(selectedDistributor) : null} />
          </div>
        )}

        {/* NFT Management Section */}
        {publicKey && (
          <div className="pt-8 border-t border-gray-700">
            <NftActions selectedDistributor={selectedDistributor ? new PublicKey(selectedDistributor) : null} />
          </div>
        )}

        {/* Transaction History */}
        <div className="pt-8 border-t border-gray-700">
          <TransactionHistory transactions={transactions} onRemove={removeTransaction} />
        </div>
      </main>
    </div>
  );
}
