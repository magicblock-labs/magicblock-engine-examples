"use client";

import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { ChevronDown, RefreshCw } from "lucide-react";
import { PDAs } from "@/lib/pda";
import { shortAddress } from "@/lib/utils";
import { useDiscoverDistributors } from "@/hooks/useDiscoverDistributors";

interface DistributorSwitcherProps {
  selectedDistributor: PublicKey | null;
  onSelectDistributor: (distributor: PublicKey) => void;
}

export const DistributorSwitcher: React.FC<DistributorSwitcherProps> = ({
  selectedDistributor,
  onSelectDistributor,
}) => {
  const { publicKey } = useWallet();
  const { distributors, loading, error, refetch } = useDiscoverDistributors(publicKey);
  const [isOpen, setIsOpen] = useState(false);

  // Get primary distributor from PDA
  const primaryDistributor = publicKey ? PDAs.getRewardDistributor(publicKey)[0] : null;

  if (!publicKey) {
    return null;
  }

  // Only show discovered distributors that actually exist
  const displayDistributors = distributors;

  return (
    <div className="card p-4 mb-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-300">
            Reward Distributor
          </label>
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="p-1 hover:bg-gray-600 rounded transition disabled:opacity-50"
            title="Refresh distributors"
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="relative">
          <button
            onClick={() => setIsOpen(!isOpen)}
            disabled={loading}
            className="w-full p-3 bg-gray-700 hover:bg-gray-600 text-white rounded border border-gray-600 flex items-center justify-between transition disabled:opacity-50"
          >
            <div className="text-left">
              <div className="text-sm font-medium">
                {selectedDistributor
                  ? shortAddress(selectedDistributor, 8)
                  : "Select Distributor"}
              </div>
              <div className="text-xs text-gray-400">
                {selectedDistributor?.equals(primaryDistributor)
                  ? "Your Distributor"
                  : selectedDistributor ? "Other Distributor" : ""}
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-gray-400 transition ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {/* Dropdown */}
          {isOpen && !loading && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded shadow-lg z-10 max-h-64 overflow-y-auto">
              {displayDistributors.length > 0 ? (
                <>
                  {displayDistributors.map((dist, index) => (
                    <button
                      key={dist.publicKey.toString()}
                      onClick={() => {
                        onSelectDistributor(dist.publicKey);
                        setIsOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 hover:bg-gray-600 transition ${
                        selectedDistributor?.equals(dist.publicKey)
                          ? "bg-blue-600 text-white"
                          : "text-gray-200"
                      } ${index === 0 ? "border-b border-gray-600" : ""}`}
                    >
                      <div className="flex items-center justify-between w-full gap-2">
                        <div className="flex-1">
                          <div className="text-sm font-medium">
                            {shortAddress(dist.publicKey, 8)}
                          </div>
                          <div className="text-xs text-gray-400 flex gap-1 mt-0.5">
                            {dist.isAdmin && <span className="text-green-400">✓ Admin</span>}
                            {dist.isWhitelisted && <span className="text-blue-400">✓ Whitelisted</span>}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {dist.publicKey.equals(primaryDistributor) && (
                            <span className="text-xs bg-green-600 text-white px-2 py-1 rounded whitespace-nowrap">
                              Primary
                            </span>
                          )}
                          {dist.isAdmin && !dist.publicKey.equals(primaryDistributor) && (
                            <span className="text-xs bg-purple-600 text-white px-2 py-1 rounded whitespace-nowrap">
                              Admin
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}

                  <div className="px-3 py-2 bg-gray-800 text-xs text-gray-500 border-t border-gray-600">
                    Found {displayDistributors.length} distributor
                    {displayDistributors.length !== 1 ? "s" : ""}
                  </div>
                </>
              ) : (
                <div className="px-3 py-2 text-xs text-gray-400">
                  No distributors found
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="text-xs text-red-400 p-2 bg-red-900 bg-opacity-20 rounded">
            {error}
          </div>
        )}

        {selectedDistributor && (
          <div className="text-xs text-gray-400 mt-2 p-2 bg-gray-800 rounded">
            PDA: <code>{shortAddress(selectedDistributor, 6)}</code>
          </div>
        )}
      </div>
    </div>
  );
};
