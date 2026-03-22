"use client";

import React from "react";
import { Clock, TrendingUp } from "lucide-react";
import { RewardsList } from "@/lib/types";

interface RewardListCardProps {
  rewardList: RewardsList;
}

export function RewardListCard({ rewardList }: RewardListCardProps) {
  const startDate = new Date(Number(rewardList.startTimestamp) * 1000);
  const endDate = new Date(Number(rewardList.endTimestamp) * 1000);
  const now = new Date();
  const isActive = startDate <= now && now <= endDate;

  return (
    <div className="card">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold text-white">
            Reward Schedule
          </h2>
          {rewardList.delegated !== undefined && (
            <span className={`text-xs font-medium px-2 py-1 rounded ${
              rewardList.delegated
                ? 'bg-blue-600 text-white'
                : 'bg-gray-600 text-gray-300'
            }`}>
              {rewardList.delegated ? '✓ Delegated' : 'Not Delegated'}
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
    </div>
  );
}
