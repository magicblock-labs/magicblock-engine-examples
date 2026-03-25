"use client";

import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { ChevronDown, RefreshCw } from "lucide-react";
import { PDAs } from "@/lib/pda";
import { shortAddress } from "@/lib/utils";
import { useDiscoverDistributors } from "@/hooks/useDiscoverDistributors";
import { CopyableAddress } from "./CopyableAddress";

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
  const [customPda, setCustomPda] = useState("");

  // Get primary distributor from PDA
  const primaryDistributor = publicKey ? PDAs.getRewardDistributor(publicKey)[0] : null;

  if (!publicKey) {
    return null;
  }

  // Only show discovered distributors that actually exist
  const displayDistributors = distributors;

  const handleCustomPdaChange = (value: string) => {
    setCustomPda(value);
    
    // Auto-validate and apply if it looks like a valid address
    if (value.trim().length >= 44) {
      try {
        new PublicKey(value.trim());
        onSelectDistributor(new PublicKey(value.trim()));
        setCustomPda("");
        setIsOpen(false);
      } catch {
        // Invalid address, but don't show error yet - user might still be typing
      }
    }
  };

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
           {selectedDistributor ? (
             <div className="w-full p-3 bg-gray-700 rounded border border-gray-600">
               <div className="text-xs text-gray-400 mb-2">Selected Distributor</div>
               <CopyableAddress 
                 address={selectedDistributor.toString()}
                 className="text-white font-mono text-sm"
                 showIcon={true}
               />
               {primaryDistributor && selectedDistributor?.equals(primaryDistributor) && (
                 <div className="text-xs text-gray-400 mt-2">Your Distributor</div>
               )}
             </div>
           ) : (
             <button
               onClick={() => setIsOpen(!isOpen)}
               disabled={loading}
               className="w-full p-3 bg-gray-700 hover:bg-gray-600 text-white rounded border border-gray-600 flex items-center justify-between transition disabled:opacity-50"
             >
               <div className="text-left">
                 <div className="text-sm font-medium">Select Distributor</div>
               </div>
               <ChevronDown
                 className={`w-4 h-4 text-gray-400 transition ${
                   isOpen ? "rotate-180" : ""
                 }`}
               />
             </button>
           )}
           
           <button
             onClick={() => setIsOpen(!isOpen)}
             disabled={loading}
             className={`w-full mt-2 p-2 text-sm text-gray-300 hover:text-gray-100 rounded border border-gray-600 transition disabled:opacity-50 ${
               isOpen ? "bg-gray-600" : "bg-gray-700 hover:bg-gray-600"
             }`}
           >
             {isOpen ? "Hide Options" : "Show Options"}
           </button>

          {/* Dropdown */}
          {isOpen && !loading && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded shadow-lg z-10 max-h-96 overflow-y-auto">
             {/* Discovered Distributors */}
              {displayDistributors.length > 0 ? (
                <>
                 <div className="px-3 py-2 bg-gray-800 text-xs text-gray-500">
                   Discovered Distributors
                 </div>
                  {displayDistributors.map((dist) => (
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
                      }`}
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
                          {primaryDistributor && dist.publicKey.equals(primaryDistributor) && (
                            <span className="text-xs bg-green-600 text-white px-2 py-1 rounded whitespace-nowrap">
                              Primary
                            </span>
                          )}
                          {dist.isAdmin && (!primaryDistributor || !dist.publicKey.equals(primaryDistributor)) && (
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

             {/* Custom PDA Input */}
             <div className="px-3 py-3 border-t border-gray-600 bg-gray-800">
               <input
                 type="text"
                 value={customPda}
                 onChange={(e) => handleCustomPdaChange(e.target.value)}
                 placeholder="Paste custom distributor address..."
                 className="w-full px-2 py-2 text-sm bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none placeholder-gray-500"
               />
             </div>
            </div>
          )}
        </div>

        {error && (
           <div className="text-xs text-red-400 p-2 bg-red-900 bg-opacity-20 rounded">
             {error}
           </div>
         )}
        </div>
        </div>
        );
        };
