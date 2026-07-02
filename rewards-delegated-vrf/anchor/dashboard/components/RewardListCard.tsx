"use client";

import React, { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Connection } from "@solana/web3.js";
import { Clock, TrendingUp, Coins, AlertTriangle } from "lucide-react";
import { RewardsList } from "@/lib/types";
import { PDAs } from "@/lib/pda";
import { resolveEndpoint } from "@/lib/endpoints";
import { CopyableAddress } from "./CopyableAddress";

interface RewardListCardProps {
  rewardList: RewardsList;
}

type SolBalanceState =
  | { status: "loading" }
  | { status: "not-found"; endpoint: string }
  | { status: "error"; endpoint: string; message: string }
  | { status: "found"; endpoint: string; totalLamports: number; rentExemptLamports: number };

function lamportsToSol(lamports: number): string {
  return (lamports / 1e9).toFixed(6);
}

export function RewardListCard({ rewardList }: RewardListCardProps) {
  const { connection } = useConnection();
  const [solBalance, setSolBalance] = useState<SolBalanceState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setSolBalance({ status: "loading" });

    const fetchBalance = async () => {
      // If delegated the live state is on the ER, otherwise it's on the Solana base layer
      const targetEndpoint = rewardList.delegated
        ? resolveEndpoint(connection.rpcEndpoint, "magicblock")
        : resolveEndpoint(connection.rpcEndpoint, "solana");

      try {
        const rewardListPda = PDAs.getRewardList(rewardList.rewardDistributor)[0];
        const targetConnection = new Connection(targetEndpoint, "confirmed");

        // Use getBalance() instead of getAccountInfo() — avoids web3.js superstruct
        // validation issues that some ER endpoints trigger on getAccountInfo responses.
        const lamports = await targetConnection.getBalance(rewardListPda, "confirmed");

        if (cancelled) return;

        if (lamports === 0) {
          setSolBalance({ status: "not-found", endpoint: targetEndpoint });
          return;
        }

        // Fetch data size from the Solana base layer to compute the rent-exempt minimum.
        // The account structure (and its size) is identical on both Solana and the ER, so
        // we can use the base layer to avoid any ER encoding quirks with getAccountInfo.
        const solEndpoint = resolveEndpoint(connection.rpcEndpoint, "solana");
        const solConnection = solEndpoint === targetEndpoint
          ? targetConnection
          : new Connection(solEndpoint, "confirmed");
        const solAccountInfo = await solConnection.getAccountInfo(rewardListPda);

        if (cancelled) return;

        const dataLength = solAccountInfo?.data.length ?? 0;
        const rentExempt = await solConnection.getMinimumBalanceForRentExemption(dataLength);

        if (!cancelled) {
          setSolBalance({
            status: "found",
            endpoint: targetEndpoint,
            totalLamports: lamports,
            rentExemptLamports: rentExempt,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[RewardListCard] Failed to fetch SOL balance from", targetEndpoint, err);
        if (!cancelled) {
          setSolBalance({ status: "error", endpoint: targetEndpoint, message });
        }
      }
    };

    void fetchBalance();
    return () => { cancelled = true; };
  }, [rewardList.rewardDistributor.toBase58(), rewardList.delegated, connection.rpcEndpoint]);

  const rewardListPda = PDAs.getRewardList(rewardList.rewardDistributor)[0];
  const startDate = new Date(Number(rewardList.startTimestamp) * 1000);
  const endDate = new Date(Number(rewardList.endTimestamp) * 1000);
  const now = new Date();
  const isActive = startDate <= now && now <= endDate;

  const LAMPORTS_PER_TX = 50_000;
  // Rent-exempt minimum for a 165-byte SPL token account (ATA created on each redemption)
  const LAMPORTS_PER_TOKEN_ACCOUNT = 2_039_280;
  const LAMPORTS_PER_REDEMPTION = LAMPORTS_PER_TX + LAMPORTS_PER_TOKEN_ACCOUNT;
  const totalRemaining = rewardList.rewards.reduce(
    (sum, r) => sum + Math.max(0, Number(r.redemptionLimit) - Number(r.redemptionCount)),
    0
  );

  return (
    <div className="card">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-xl font-semibold text-white mb-1">
              Reward Schedule
            </h2>
            <CopyableAddress address={rewardListPda.toBase58()} displayLength={16} />
          </div>
          {rewardList.delegated !== undefined && (
            <span className={`text-xs font-medium px-2 py-1 rounded ${
              rewardList.delegated
                ? "bg-blue-600 text-white"
                : "bg-gray-600 text-gray-300"
            }`}>
              {rewardList.delegated ? "✓ Delegated" : "Not Delegated"}
            </span>
          )}
        </div>
        <div
          className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
            isActive
              ? "bg-green-900 text-green-200"
              : "bg-gray-700 text-gray-300"
          }`}
        >
          {isActive ? "Active" : "Inactive"}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-start gap-3">
          <Clock className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-1" />
          <div>
            <p className="text-gray-400 text-sm">Start Date</p>
            <p className="font-semibold text-white">
              {startDate.toLocaleDateString()}
            </p>
            <p className="text-gray-500 text-xs">
              {startDate.toLocaleTimeString()}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Clock className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-1" />
          <div>
            <p className="text-gray-400 text-sm">End Date</p>
            <p className="font-semibold text-white">
              {endDate.toLocaleDateString()}
            </p>
            <p className="text-gray-500 text-xs">
              {endDate.toLocaleTimeString()}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <TrendingUp className="w-5 h-5 text-green-400 flex-shrink-0 mt-1" />
          <div>
            <p className="text-gray-400 text-sm">Draw Range</p>
            <p className="font-semibold text-white">
              {rewardList.globalRangeMin} - {rewardList.globalRangeMax}
            </p>
            <p className="text-gray-500 text-xs">
              Total Range: {rewardList.globalRangeMax - rewardList.globalRangeMin + 1}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div>
            <p className="text-gray-400 text-sm">Total Rewards</p>
            <p className="font-semibold text-white text-lg">
              {rewardList.rewards.length}
            </p>
          </div>
        </div>
      </div>

      {/* SOL balance breakdown */}
      <div className="mt-4 pt-4 border-t border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-orange-400" />
            <p className="text-sm font-medium text-gray-300">SOL Balance</p>
          </div>
          {solBalance.status !== "loading" && (
            <span
              className="text-xs text-gray-500 truncate max-w-[180px]"
              title={solBalance.endpoint}
            >
              {rewardList.delegated ? "ER" : "Solana"} · {solBalance.endpoint.replace(/https?:\/\//, "").replace(/\/$/, "")}
            </span>
          )}
        </div>

        {solBalance.status === "loading" && (
          <p className="text-xs text-gray-500 italic">Fetching balance…</p>
        )}

        {solBalance.status === "not-found" && (
          <p className="text-xs text-gray-500 italic">
            Account not found on {rewardList.delegated ? "ER" : "Solana"}
            {rewardList.delegated ? " — the account may not be synced yet" : ""}
          </p>
        )}

        {solBalance.status === "error" && (
          <p className="text-xs text-red-400 italic" title={solBalance.message}>
            Failed to fetch balance — check console for details
          </p>
        )}

        {solBalance.status === "found" && (() => {
          const excess = solBalance.totalLamports - solBalance.rentExemptLamports;
          const estimatedTxs = Math.floor(excess / LAMPORTS_PER_REDEMPTION);
          const insufficientFunds = totalRemaining > 0 && estimatedTxs < totalRemaining;
          return (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded bg-gray-800/60 p-2">
                  <p className="text-xs text-gray-400 mb-1">Total</p>
                  <p className="text-sm font-mono font-semibold text-white">
                    {lamportsToSol(solBalance.totalLamports)}
                  </p>
                  <p className="text-xs text-gray-500">SOL</p>
                </div>
                <div className="rounded bg-gray-800/60 p-2">
                  <p className="text-xs text-gray-400 mb-1">Rent-free deposit</p>
                  <p className="text-sm font-mono font-semibold text-gray-300">
                    {lamportsToSol(solBalance.rentExemptLamports)}
                  </p>
                  <p className="text-xs text-gray-500">SOL</p>
                </div>
                <div className="rounded bg-gray-800/60 p-2">
                  <p className="text-xs text-gray-400 mb-1">Excess</p>
                  <p className={`text-sm font-mono font-semibold ${
                    insufficientFunds ? "text-red-400" : excess > 0 ? "text-green-400" : "text-yellow-400"
                  }`}>
                    {lamportsToSol(excess)}
                  </p>
                  <p className={`text-xs mt-0.5 ${
                    insufficientFunds ? "text-red-400" : "text-gray-500"
                  }`}>
                    ~{estimatedTxs.toLocaleString()} txs
                  </p>
                </div>
              </div>
              {insufficientFunds && (
                <div className="mt-2 flex items-start gap-2 rounded border border-red-700 bg-red-900/20 p-2 text-xs text-red-300">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    Only ~{estimatedTxs.toLocaleString()} transaction{estimatedTxs !== 1 ? "s" : ""} covered but{" "}
                    {totalRemaining.toLocaleString()} redemption{totalRemaining !== 1 ? "s" : ""} remaining.
                    Top up the reward list to ensure all rewards can be processed.
                  </span>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
