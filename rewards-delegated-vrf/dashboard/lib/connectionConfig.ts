/**
 * Connection configuration for different Solana networks
 */

export interface ConnectionConfig {
  name: string;
  endpoint: string;
  wsEndpoint?: string;
  commitment?: "confirmed" | "finalized" | "processed";
  description: string;
}

export const CONNECTIONS: Record<string, ConnectionConfig> = {
  devnet: {
    name: "Solana Devnet",
    endpoint: "https://api.devnet.solana.com",
    wsEndpoint: "wss://api.devnet.solana.com",
    commitment: "confirmed",
    description: "Solana Development Network - for testing",
  },
  mainnet: {
    name: "Solana Mainnet",
    endpoint: "https://api.mainnet-beta.solana.com",
    wsEndpoint: "wss://api.mainnet-beta.solana.com",
    commitment: "finalized",
    description: "Solana Production Network",
  },
  magicblock: {
    name: "MagicBlock Ephemeral Rollup",
    endpoint:
      process.env.NEXT_PUBLIC_EPHEMERAL_PROVIDER_ENDPOINT ||
      "https://devnet-as.magicblock.app/",
    wsEndpoint:
      process.env.NEXT_PUBLIC_EPHEMERAL_WS_ENDPOINT ||
      "wss://devnet-as.magicblock.app/",
    commitment: "confirmed",
    description: "MagicBlock Ephemeral Rollup - for VRF operations",
  },
  localhost: {
    name: "Localhost",
    endpoint: "http://localhost:8899",
    wsEndpoint: "ws://localhost:8900",
    commitment: "confirmed",
    description: "Local Solana validator",
  },
};

export const DEFAULT_CONNECTION = "devnet";

/**
 * Get connection configuration by key
 */
export function getConnection(key: string): ConnectionConfig | null {
  return CONNECTIONS[key] || null;
}

/**
 * Get all available connections
 */
export function getAllConnections(): ConnectionConfig[] {
  return Object.values(CONNECTIONS);
}

/**
 * Validate RPC endpoint format
 */
export function isValidRpcEndpoint(endpoint: string): boolean {
  try {
    new URL(endpoint);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save connection preference to localStorage
 */
export function saveConnectionPreference(connectionKey: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("solana-connection", connectionKey);
  }
}

/**
 * Load connection preference from localStorage
 */
export function loadConnectionPreference(): string {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("solana-connection");
    if (saved && CONNECTIONS[saved]) {
      return saved;
    }
  }
  return DEFAULT_CONNECTION;
}

/**
 * Clear connection preference from localStorage
 */
export function clearConnectionPreference(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("solana-connection");
  }
}
