/**
 * Cluster configuration management
 * Provides cluster information and utilities for the application
 */

export interface ClusterInfo {
  name: string;
  endpoint: string;
  wsEndpoint?: string;
}

export const RPC_ENDPOINT_STORAGE_KEY = "solana-rpc-endpoint";
export const CLUSTER_ENDPOINT_STORAGE_KEY = "solana-cluster-endpoint";
export const RPC_ENDPOINT_CHANGED_EVENT = "solana-rpc-endpoint-changed";

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

export const CLUSTER_CONFIG: Record<string, ClusterInfo> = {
  "https://rpc.magicblock.app/devnet": {
    name: "Solana Devnet",
    endpoint: "https://rpc.magicblock.app/devnet",
    wsEndpoint: "wss://rpc.magicblock.app/devnet",
  },
  "https://rpc.magicblock.app/mainnet": {
    name: "Solana Mainnet",
    endpoint: "https://rpc.magicblock.app/mainnet",
    wsEndpoint: "wss://rpc.magicblock.app/mainnet",
  },
  "https://devnet-as.magicblock.app/": {
    name: "MagicBlock Devnet Asia",
    endpoint: "https://devnet-as.magicblock.app/",
    wsEndpoint: "wss://devnet-as.magicblock.app/",
  },
  "https://as.magicblock.app": {
    name: "MagicBlock Mainnet Asia",
    endpoint: "https://as.magicblock.app",
    wsEndpoint: "wss://as.magicblock.app",
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
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const configEntry = Object.entries(CLUSTER_CONFIG).find(
    ([configuredEndpoint]) => normalizeEndpoint(configuredEndpoint) === normalizedEndpoint
  );
  return configEntry?.[1].name || "Unknown Cluster";
}

/**
 * Get the explorer URL for a transaction on a specific cluster/endpoint
 */
export function getExplorerUrl(signature: string, endpoint: string): string {
  const baseUrl = "https://explorer.solana.com/tx/";
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  
  // Map endpoints to cluster query parameters
  if (normalizedEndpoint.includes("mainnet")) {
    return `${baseUrl}${signature}`;
  } else if (
    normalizedEndpoint.includes("devnet") &&
    !normalizedEndpoint.includes("localhost") &&
    !normalizedEndpoint.includes("magicblock")
  ) {
    return `${baseUrl}${signature}?cluster=devnet`;
  }
  
  // For all custom endpoints (localhost, magicblock, or any other custom RPC), use custom cluster format
  // This handles: localhost, magicblock, or any other custom RPC endpoint
  return `${baseUrl}${signature}?cluster=custom&customUrl=${encodeURIComponent(normalizedEndpoint)}`;
}

/**
 * Save cluster preference to localStorage
 */
export function saveClusterPreference(endpoint: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(CLUSTER_ENDPOINT_STORAGE_KEY, endpoint);
  }
}

/**
 * Load cluster preference from localStorage
 */
export function loadClusterPreference(): string | null {
  if (typeof window !== "undefined") {
    return localStorage.getItem(CLUSTER_ENDPOINT_STORAGE_KEY);
  }
  return null;
}

/**
 * Clear cluster preference from localStorage
 */
export function clearClusterPreference(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(CLUSTER_ENDPOINT_STORAGE_KEY);
  }
}

export function loadRpcEndpointPreference(): string | null {
  if (typeof window !== "undefined") {
    return localStorage.getItem(RPC_ENDPOINT_STORAGE_KEY);
  }
  return null;
}

export function saveRpcEndpointPreference(endpoint: string): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(RPC_ENDPOINT_STORAGE_KEY, endpoint);
  localStorage.setItem(CLUSTER_ENDPOINT_STORAGE_KEY, endpoint);
  window.dispatchEvent(
    new CustomEvent(RPC_ENDPOINT_CHANGED_EVENT, {
      detail: { endpoint },
    })
  );
}

/**
 * Get the default/fallback endpoint for Solana (not MagicBlock ER)
 */
export function getDefaultSolanaEndpoint(): string {
  return CLUSTER_CONFIG["https://rpc.magicblock.app/devnet"].endpoint;
}

/**
 * Get the default/fallback endpoint for MagicBlock ER (Ephemeral Rollups)
 * Defaults to MagicBlock Devnet Asia
 */
export function getDefaultMagicBlockErEndpoint(): string {
  return CLUSTER_CONFIG["https://devnet-as.magicblock.app/"].endpoint;
}

/**
 * Resolve the base-layer Solana RPC to use for reads when a paired MagicBlock
 * endpoint is selected. Custom endpoints are left unchanged.
 */
export function getBaseLayerSolanaEndpoint(endpoint: string): string {
  const normalizedEndpoint = normalizeEndpoint(endpoint);

  if (
    normalizedEndpoint === normalizeEndpoint(CLUSTER_CONFIG["https://rpc.magicblock.app/devnet"].endpoint) ||
    normalizedEndpoint === normalizeEndpoint(CLUSTER_CONFIG["https://devnet-as.magicblock.app/"].endpoint)
  ) {
    return CLUSTER_CONFIG["https://rpc.magicblock.app/devnet"].endpoint;
  }

  if (
    normalizedEndpoint === normalizeEndpoint(CLUSTER_CONFIG["https://rpc.magicblock.app/mainnet"].endpoint) ||
    normalizedEndpoint === normalizeEndpoint(CLUSTER_CONFIG["https://as.magicblock.app"].endpoint)
  ) {
    return CLUSTER_CONFIG["https://rpc.magicblock.app/mainnet"].endpoint;
  }

  return endpoint;
}
