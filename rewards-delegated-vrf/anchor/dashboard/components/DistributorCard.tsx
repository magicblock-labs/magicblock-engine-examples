"use client";

import React from "react";
import { RewardDistributor } from "@/lib/types";
import { CopyableAddress } from "./CopyableAddress";

interface DistributorCardProps {
  distributor: RewardDistributor;
  address: string;
}

export function DistributorCard({ distributor, address }: DistributorCardProps) {
  return (
    <div className="card">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold text-white">
            Reward Distributor
          </h2>
          {distributor.delegated !== undefined && (
            <span className={`text-xs font-medium px-2 py-1 rounded ${
              distributor.delegated
                ? 'bg-blue-600 text-white'
                : 'bg-gray-600 text-gray-300'
            }`}>
              {distributor.delegated ? '✓ Delegated' : 'Not Delegated'}
            </span>
          )}
        </div>
        <div className="bg-gray-700 rounded-lg p-3 mb-2">
          <CopyableAddress 
            address={address}
            className="text-white font-mono text-sm"
            showIcon={true}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-gray-400 text-sm">Super Admin</p>
          <p className="font-mono text-xs text-indigo-400 break-all">
            {distributor.superAdmin.toString()}
          </p>
        </div>

        <div>
          <p className="text-gray-400 text-sm">Total Admins</p>
          <p className="text-lg font-semibold text-white">
            {distributor.admins.length}
          </p>
        </div>

        <div className="md:col-span-2">
         <p className="text-gray-400 text-sm mb-2">Admins</p>
         <div className="space-y-1 max-h-32 overflow-y-auto">
           {distributor.admins.length > 0 ? (
             distributor.admins.map((admin, idx) => (
               <div
                 key={idx}
                 className="text-xs font-mono bg-gray-700 px-2 py-1 rounded text-indigo-300 break-all"
               >
                 {admin.toString()}
               </div>
             ))
           ) : (
             <p className="text-gray-500 text-xs">No admins configured</p>
           )}
         </div>
        </div>

        {distributor.whitelist.length > 0 && (
         <div className="md:col-span-2">
           <p className="text-gray-400 text-sm mb-2">Whitelist</p>
           <div className="space-y-1 max-h-32 overflow-y-auto">
             {distributor.whitelist.map((item, idx) => (
               <div
                 key={idx}
                 className="text-xs font-mono bg-gray-700 px-2 py-1 rounded text-green-300 break-all"
               >
                 {item.toString()}
               </div>
             ))}
           </div>
         </div>
        )}
      </div>
    </div>
  );
}
