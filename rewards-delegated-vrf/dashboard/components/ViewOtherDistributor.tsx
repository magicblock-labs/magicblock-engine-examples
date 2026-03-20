"use client";

import React, { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Search, Zap, Copy, Check } from "lucide-react";
import { shortAddress } from "@/lib/utils";
import { PDAs } from "@/lib/pda";
import { ProgramClient } from "@/lib/program";
import {
  RewardDistributor,
  RewardsList,
} from "@/lib/types";
import { useDiscoverDistributors } from "@/hooks/useDiscoverDistributors";
import { DistributorCard } from "./DistributorCard";
import { RewardListCard } from "./RewardListCard";
import { RewardsTable } from "./RewardsTable";
import { LoadingSpinner } from "./LoadingSpinner";
import { ErrorMessage } from "./ErrorMessage";

interface AdminDistributor {
  address: PublicKey;
  distributor: RewardDistributor;
  rewardList: RewardsList | null;
  loading?: boolean;
}

export function ViewOtherDistributor() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { distributors, loading: discovering, error: discoverError } = useDiscoverDistributors(publicKey);
  
  const [searchAddress, setSearchAddress] = useState("");
  const [distributor, setDistributor] = useState<RewardDistributor | null>(
    null
  );
  const [rewardList, setRewardList] = useState<RewardsList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearhed] = useState(false);
  const [searchType, setSearchType] = useState<"wallet" | "distributor">("wallet");
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const copyToClipboard = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const handleSearch = async () => {
    if (!searchAddress.trim()) {
      setError("Please enter a valid address");
      return;
    }

    setLoading(true);
    setError(null);
    setSearhed(true);

    try {
      const client = new ProgramClient(connection.rpcEndpoint);
      let distributorPda: PublicKey;
      let dist: RewardDistributor | null;
      let rewards: RewardsList | null;

      if (searchType === "wallet") {
        // Search by wallet address - derive the distributor PDA
        const wallet = new PublicKey(searchAddress);
        [distributorPda] = PDAs.getRewardDistributor(wallet);
      } else {
        // Search by distributor address directly
        distributorPda = new PublicKey(searchAddress);
      }

      const [rewardListPda] = PDAs.getRewardList(distributorPda);

      [dist, rewards] = await Promise.all([
        client.fetchRewardDistributor(distributorPda),
        client.fetchRewardsList(rewardListPda),
      ]);

      if (!dist) {
        setError("No reward distributor found at this address");
        setDistributor(null);
        setRewardList(null);
      } else {
        setDistributor(dist);
        setRewardList(rewards);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid address";
      setError(message);
      setDistributor(null);
      setRewardList(null);
    } finally {
      setLoading(false);
    }
  };



  return (
    <div className="card">
      {/* Manual search section */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">
          Search for Other Distributors
        </h3>

        <div className="flex gap-2 mb-4">
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              placeholder="Enter wallet address..."
              value={searchAddress}
              onChange={(e) => setSearchAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-indigo-500 focus:outline-none placeholder-gray-500"
            />
            <button
              onClick={handleSearch}
              disabled={loading}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Search className="w-4 h-4" />
              {loading ? "Searching..." : "Search"}
            </button>
          </div>
        </div>

        {error && <ErrorMessage message={error} />}

        {loading && <LoadingSpinner />}

        {searched && !loading && distributor && (
          <div className="space-y-4 mt-4">
            <DistributorCard
              distributor={distributor}
              address={new PublicKey(
                    PDAs.getRewardDistributor(new PublicKey(searchAddress))[0]
                  ).toString()
                }
            />
            {rewardList && (
              <>
                <RewardListCard rewardList={rewardList} />
                <RewardsTable rewards={rewardList.rewards} />
              </>
            )}
          </div>
        )}

        {searched && !loading && !distributor && !error && (
          <div className="text-center py-8 text-gray-400">
            No data found for this address
          </div>
        )}
      </div>
    </div>
  );
}
