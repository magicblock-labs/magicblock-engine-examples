/**
 * Cluster configuration management
 * Provides cluster information and utilities for the application
 */

export interface ClusterInfo {
  name: string;
  endpoint: string;
  wsEndpoint?: string;
}

export const CLUSTER_CONFIG: Record<string, ClusterInfo> = {
  "https://api.devnet.solana.com": {
    name: "Solana Devnet",
    endpoint: "https://api.devnet.solana.com",
    wsEndpoint: "wss://api.devnet.solana.com",
  },
  "https://api.mainnet-beta.solana.com": {
    name: "Solana Mainnet",
    endpoint: "https://api.mainnet-beta.solana.com",
    wsEndpoint: "wss://api.mainnet-beta.solana.com",
  },
  "https://devnet-as.magicblock.app/": {
    name: "MagicBlock Devnet Asia",
    endpoint: "https://devnet-as.magicblock.app/",
    wsEndpoint: "wss://devnet-as.magicblock.app/",
  },
  "http://localhost:8899": {
    name: "Localhost",
    endpoint: "http://localhost:8899",
    wsEndpoint: "ws://localhost:8900",
  },
};

/**
 * Get the cluster name for a given endpoint
 */
export function getClusterName(endpoint: string): string {
  const config = CLUSTER_CONFIG[endpoint];
  return config?.name || "Unknown Cluster";
}

/**
 * Get the explorer URL for a transaction on a specific cluster/endpoint
 */
export function getExplorerUrl(signature: string, endpoint: string): string {
  const baseUrl = "https://explorer.solana.com/tx/";
  
  // Map endpoints to cluster query parameters
  if (endpoint.includes("mainnet")) {
    return `${baseUrl}${signature}`;
  } else if (endpoint.includes("devnet") && !endpoint.includes("localhost") && !endpoint.includes("magicblock")) {
    return `${baseUrl}${signature}?cluster=devnet`;
  }
  
  // For all custom endpoints (localhost, magicblock, or any other custom RPC), use custom cluster format
  // This handles: localhost, magicblock, or any other custom RPC endpoint
  return `${baseUrl}${signature}?cluster=custom&customUrl=${encodeURIComponent(endpoint)}`;
}

/**
 * Save cluster preference to localStorage
 */
export function saveClusterPreference(endpoint: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("solana-cluster-endpoint", endpoint);
  }
}

/**
 * Load cluster preference from localStorage
 */
export function loadClusterPreference(): string | null {
  if (typeof window !== "undefined") {
    return localStorage.getItem("solana-cluster-endpoint");
  }
  return null;
}

/**
 * Clear cluster preference from localStorage
 */
export function clearClusterPreference(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("solana-cluster-endpoint");
  }
}
