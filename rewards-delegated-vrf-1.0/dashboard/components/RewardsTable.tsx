"use client";

import React from "react";
import { Copy, Award } from "lucide-react";
import { Reward } from "@/lib/types";
import {
  truncateAddress,
  formatNumber,
  getRedemptionPercentage,
  getRewardTypeName,
  getRewardTypeColor,
} from "@/lib/utils";

interface RewardsTableProps {
  rewards: Reward[] | null | undefined;
}

export function RewardsTable({ rewards }: RewardsTableProps) {
  const [copied, setCopied] = React.useState<string | null>(null);

  // Validate rewards data
  if (!rewards || !Array.isArray(rewards)) {
    return (
      <div className="card">
        <div className="text-center py-8">
          <Award className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No rewards found</p>
        </div>
      </div>
    );
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  };



  if (rewards.length === 0) {
    return (
      <div className="card">
        <div className="text-center py-8">
          <Award className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No rewards configured yet</p>
        </div>
      </div>
    );
  }

  const totalRemaining = rewards.reduce(
    (sum, r) => sum + Math.max(0, Number(r.redemptionLimit) - Number(r.redemptionCount)),
    0
  );

  return (
    <div className="card overflow-x-auto">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-xl font-semibold text-white">Rewards</h2>
        <span className="text-sm text-gray-400">{totalRemaining.toLocaleString()} / {rewards.reduce((sum, r) => sum + Number(r.redemptionLimit), 0).toLocaleString()} remaining</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="text-left py-3 px-3 text-gray-400 font-semibold">
              Name
            </th>
            <th className="text-left py-3 px-3 text-gray-400 font-semibold">
              Type
            </th>
            <th className="text-center py-3 px-3 text-gray-400 font-semibold">
              Range
            </th>
            <th className="text-right py-3 px-3 text-gray-400 font-semibold">
              Amount
            </th>
            <th className="text-center py-3 px-3 text-gray-400 font-semibold">
              Redeemed
            </th>
            <th className="text-center py-3 px-3 text-gray-400 font-semibold">
              Mints
            </th>
          </tr>
        </thead>
        <tbody>
          {rewards.map((reward, idx) => (
            <tr key={idx} className="border-b border-gray-700 hover:bg-gray-750">
              <td className="py-3 px-3 font-medium text-white">
                {reward.name}
              </td>
              <td className="py-3 px-3">
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${
                    reward?.rewardType
                      ? getRewardTypeColor(reward.rewardType)
                      : "bg-gray-700 text-gray-200"
                  }`}
                >
                  {reward?.rewardType
                    ? getRewardTypeName(reward.rewardType)
                    : "Unknown"}
                </span>
              </td>
              <td className="py-3 px-3 text-center text-gray-300">
                {reward.drawRangeMin} - {reward.drawRangeMax}
              </td>
              <td className="py-3 px-3 text-right text-gray-300 font-mono">
                {formatNumber(Number(reward.rewardAmount))}
              </td>
              <td className="py-3 px-3 text-center">
                <div className="text-white font-semibold">
                  {formatNumber(Number(reward.redemptionCount))}
                </div>
                <div className="text-gray-500 text-xs">
                  / {formatNumber(Number(reward.redemptionLimit))}
                </div>
                {Number(reward.redemptionLimit) > 0 && (
                  <div className="mt-1 w-full bg-gray-600 rounded-full h-1.5">
                    <div
                      className="bg-indigo-500 h-1.5 rounded-full transition-all"
                      style={{
                        width: `${getRedemptionPercentage(
                          reward.redemptionCount,
                          reward.redemptionLimit
                        )}%`,
                      }}
                    />
                  </div>
                )}
              </td>
              <td className="py-3 px-3">
                <div className="space-y-1">
                  {reward?.rewardMints && Array.isArray(reward.rewardMints) ? (
                    <>
                      {reward.rewardMints.slice(0, 2).map((mint, midx) => {
                        try {
                          const mintStr =
                            typeof mint === "string"
                              ? mint
                              : mint?.toString?.() || "";
                          if (!mintStr) return null;

                          return (
                            <div
                              key={midx}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="font-mono text-gray-400">
                                {truncateAddress(mintStr)}
                              </span>
                              <button
                                onClick={() => copyToClipboard(mintStr)}
                                className="text-gray-500 hover:text-gray-300 transition-colors"
                              >
                                {copied === mintStr ? (
                                  "✓"
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          );
                        } catch {
                          return null;
                        }
                      })}
                      {reward.rewardMints.length > 2 && (
                        <div className="text-gray-500 text-xs">
                          +{reward.rewardMints.length - 2} more
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-gray-500 text-xs">No mints</div>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
