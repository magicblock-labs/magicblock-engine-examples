"use client";

import React, { useState, useEffect } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Network, Search, ChevronDown, Check } from "lucide-react";

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
    endpoint: "https://api.devnet.solana.com",
    wsEndpoint: "wss://api.devnet.solana.com",
    description: "Development network for testing",
    color: "bg-purple-600",
  },
  {
    name: "Solana Mainnet",
    endpoint: "https://api.mainnet-beta.solana.com",
    wsEndpoint: "wss://api.mainnet-beta.solana.com",
    description: "Production network",
    color: "bg-green-600",
  },
  {
    name: "MagicBlock Devnet",
    endpoint: process.env.NEXT_PUBLIC_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app/",
    wsEndpoint: process.env.NEXT_PUBLIC_EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app/",
    description: "Ephemeral rollup for VRF operations",
    color: "bg-blue-600",
  },
  {
    name: "MagicBlock Asia",
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

export const ConnectionSelector: React.FC = () => {
  const { connection } = useConnection();
  const [isOpen, setIsOpen] = useState(false);
  const [currentEndpoint, setCurrentEndpoint] = useState<string>("");
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  // Load persisted endpoint on mount
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("solana-rpc-endpoint") : null;
    const initial = saved || connection.rpcEndpoint || DEFAULT_CONNECTIONS[0].endpoint;
    setCurrentEndpoint(initial);
    setMounted(true);
  }, [connection.rpcEndpoint]);

  // Filter connections based on search query
  const filteredConnections = DEFAULT_CONNECTIONS.filter(
    (conn) =>
      conn.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conn.endpoint.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conn.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectConnection = (endpoint: string) => {
    setCurrentEndpoint(endpoint);
    setIsOpen(false);
    // Store in localStorage for persistence
    localStorage.setItem("solana-rpc-endpoint", endpoint);
    localStorage.setItem("solana-cluster-endpoint", endpoint);
    // Full page reload to switch connection properly
    window.location.reload();
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
    <div className="fixed top-24 left-4 z-40">
      <div className="relative w-80">
        {/* Main Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white hover:bg-gray-750 transition group"
        >
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0">
              {currentConnection?.color && (
                <div className={`w-2 h-2 rounded-full ${currentConnection.color}`} />
              )}
              {!currentConnection?.color && (
                <Network className="w-4 h-4 text-gray-400" />
              )}
            </div>
            <div className="text-left">
              <div className="text-sm font-medium text-white">
                {getCurrentConnectionName()}
              </div>
              <div className="text-xs text-gray-400 truncate max-w-xs">
                {currentEndpoint}
              </div>
            </div>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute top-full left-0 mt-2 w-full bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
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
                    className={`w-full text-left px-3 py-3 rounded transition flex items-start justify-between group ${
                      currentEndpoint === conn.endpoint
                        ? "bg-blue-600/20 border border-blue-500 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600 border border-transparent"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${conn.color}`} />
                        <div className="font-medium text-sm">{conn.name}</div>
                        {currentEndpoint === conn.endpoint && (
                          <Check className="w-4 h-4 text-blue-400 ml-auto flex-shrink-0" />
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
    </div>
  );
};
