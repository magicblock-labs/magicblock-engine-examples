"use client";

import { useEffect, useState, useCallback } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { ProgramClient } from "@/lib/program";
import { PDAs } from "@/lib/pda";
import { DASHBOARD_DATA_REFRESH_EVENT } from "@/lib/refresh";
import {
  RewardDistributor,
  RewardsList,
  TransferLookupTable,
} from "@/lib/types";

export function useRewardData(wallet: PublicKey | null, distributorAddress?: PublicKey | null) {
  const { connection } = useConnection();
  const [distributor, setDistributor] = useState<RewardDistributor | null>(null);
  const [rewardList, setRewardList] = useState<RewardsList | null>(null);
  const [lookupTable, setLookupTable] = useState<TransferLookupTable | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Perform the actual fetch - stable function that doesn't trigger effects
  const performFetch = useCallback(async (w: PublicKey, rpcEndpoint: string, distAddr?: PublicKey) => {
    setLoading(true);
    setError(null);
    setDistributor(null);
    setRewardList(null);
    setLookupTable(null);

    try {
      const client = new ProgramClient(rpcEndpoint);
      const [distributorPda] = distAddr ? [distAddr] : PDAs.getRewardDistributor(w);
      const [rewardListPda] = PDAs.getRewardList(distributorPda);
      const [lookupTablePda] = PDAs.getTransferLookupTable();

      const [dist, rewards, lookup] = await Promise.all([
        client.fetchRewardDistributor(distributorPda),
        client.fetchRewardsList(rewardListPda),
        client.fetchTransferLookupTable(lookupTablePda),
      ]);

      setDistributor(dist);
      setRewardList(rewards);
      setLookupTable(lookup);
      
      if (!dist) {
        setError(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setDistributor(null);
      setRewardList(null);
      setLookupTable(null);
      setError(message);
      console.error("Error fetching reward data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Effect to fetch data when wallet or distributor changes
  useEffect(() => {
    if (!wallet) return;

    // Fetch immediately
    performFetch(wallet, connection.rpcEndpoint, distributorAddress ?? undefined);

    const handleRefresh = () => {
      performFetch(wallet, connection.rpcEndpoint, distributorAddress ?? undefined);
    };

    window.addEventListener(DASHBOARD_DATA_REFRESH_EVENT, handleRefresh);

    return () => {
      window.removeEventListener(DASHBOARD_DATA_REFRESH_EVENT, handleRefresh);
    };
  }, [wallet?.toString(), distributorAddress?.toString(), connection.rpcEndpoint, performFetch]);

  const refetch = useCallback(() => {
    if (wallet) {
      performFetch(wallet, connection.rpcEndpoint, distributorAddress ?? undefined);
    }
  }, [wallet, distributorAddress, connection.rpcEndpoint, performFetch]);

  return { distributor, rewardList, lookupTable, loading, error, refetch };
}
