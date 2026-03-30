"use client";

import React, { useState, useEffect } from "react";
import { Network, ChevronDown, Search, Check } from "lucide-react";
import {
  getDefaultSolanaEndpoint,
  loadRpcEndpointPreference,
  saveRpcEndpointPreference,
} from "@/lib/clusterContext";
import { WalletConnect } from "./WalletConnect";

interface ConnectionOption {
  name: string;
  endpoint: string;
  wsEndpoint?: string;
  description?: string;
  color?: string;
}

const DEFAULT_CONNECTIONS: ConnectionOption[] = [
  {
    name: "Solana Devnet",
    endpoint: "https://rpc.magicblock.app/devnet",
    wsEndpoint: "wss://rpc.magicblock.app/devnet",
    description: "Development network for testing",
    color: "bg-purple-600",
  },
  {
    name: "Solana Mainnet",
    endpoint: "https://rpc.magicblock.app/mainnet",
    wsEndpoint: "wss://rpc.magicblock.app/mainnet",
    description: "Production network",
    color: "bg-green-600",
  },
  {
    name: "MagicBlock Devnet Asia",
    endpoint: process.env.NEXT_PUBLIC_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app/",
    wsEndpoint: process.env.NEXT_PUBLIC_EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app/",
    description: "Ephemeral rollup for VRF operations",
    color: "bg-blue-600",
  },
  {
    name: "MagicBlock Mainnet Asia",
    endpoint: "https://as.magicblock.app",
    wsEndpoint: "wss://as.magicblock.app",
    description: "MagicBlock mainnet Asia region",
    color: "bg-orange-600",
  },
  {
    name: "Localhost",
    endpoint: "http://localhost:8899",
    wsEndpoint: "ws://localhost:8900",
    description: "Local validator",
    color: "bg-gray-600",
  },
];

function ClusterSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentEndpoint, setCurrentEndpoint] = useState<string>("");
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = loadRpcEndpointPreference();
    const initial = saved || getDefaultSolanaEndpoint();
    setCurrentEndpoint(initial);
    setMounted(true);
  }, []);

  const filteredConnections = DEFAULT_CONNECTIONS.filter(
    (conn) =>
      conn.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conn.endpoint.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conn.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectConnection = (endpoint: string) => {
    setCurrentEndpoint(endpoint);
    setIsOpen(false);
    saveRpcEndpointPreference(endpoint);
  };

  const handleCustomEndpoint = () => {
    if (customEndpoint.trim()) {
      handleSelectConnection(customEndpoint.trim());
      setCustomEndpoint("");
    }
  };

  const getCurrentConnectionName = () => {
    const found = DEFAULT_CONNECTIONS.find((c) => c.endpoint === currentEndpoint);
    return found?.name || "Custom";
  };

  if (!mounted) {
    return null;
  }

  const currentConnection = DEFAULT_CONNECTIONS.find(
    (c) => c.endpoint === currentEndpoint
  );

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white hover:bg-gray-700 transition"
      >
        {currentConnection?.color && (
          <div className={`w-2 h-2 rounded-full ${currentConnection.color}`} />
        )}
        {!currentConnection?.color && (
          <Network className="w-4 h-4 text-gray-400" />
        )}
        <span className="text-sm font-medium">{getCurrentConnectionName()}</span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-gray-700 sticky top-0 bg-gray-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search networks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-3 py-2 bg-gray-700 text-white placeholder-gray-500 rounded text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
                autoFocus
              />
            </div>
          </div>

          {/* Preset Connections */}
          <div className="p-2 space-y-1 max-h-72 overflow-y-auto">
            {filteredConnections.length > 0 ? (
              filteredConnections.map((conn) => (
                <button
                  key={conn.endpoint}
                  onClick={() => handleSelectConnection(conn.endpoint)}
                  className={`w-full text-left px-3 py-2 rounded transition flex items-start justify-between group text-sm ${
                    currentEndpoint === conn.endpoint
                      ? "bg-blue-600/20 border border-blue-500 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600 border border-transparent"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${conn.color}`} />
                      <div className="font-medium">{conn.name}</div>
                      {currentEndpoint === conn.endpoint && (
                        <Check className="w-3 h-3 text-blue-400 ml-auto flex-shrink-0" />
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-1 truncate">
                      {conn.endpoint}
                    </div>
                    {conn.description && (
                      <div className="text-xs text-gray-500 mt-1">
                        {conn.description}
                      </div>
                    )}
                  </div>
                </button>
              ))
            ) : (
              <div className="text-center py-4 text-gray-400 text-sm">
                No networks found
              </div>
            )}
          </div>

          {/* Custom Endpoint */}
          <div className="border-t border-gray-700 p-3 space-y-2 bg-gray-750">
            <label className="text-xs font-medium text-gray-400 block">
              Custom RPC Endpoint
            </label>
            <input
              type="text"
              value={customEndpoint}
              onChange={(e) => setCustomEndpoint(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCustomEndpoint()}
              placeholder="https://..."
              className="w-full px-3 py-2 bg-gray-700 text-white placeholder-gray-500 rounded text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={handleCustomEndpoint}
              disabled={!customEndpoint.trim()}
              className="w-full px-3 py-2 bg-blue-600 text-white text-sm rounded font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              Connect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Header() {
  return (
    <header className="bg-gradient-to-r from-gray-900 to-gray-800 border-b border-gray-700 px-6 py-4 sticky top-0 z-40">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <img
            src="/magicblock-logomark-white.svg"
            alt="MagicBlock"
            className="h-8 w-auto"
          />
          <h1 className="text-2xl font-bold text-white">Rewards Dashboard</h1>
        </div>
        <div className="flex items-center gap-4">
          <ClusterSelector />
          <WalletConnect />
        </div>
      </div>
    </header>
  );
}
