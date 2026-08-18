export type AdminActionEndpointMode = "solana" | "magicblock";

// Optional per-network overrides for the base-layer Solana RPC. WS endpoints
// are derived from these (http -> ws).
export const SOLANA_DEVNET_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL ||
  "https://rpc.magicblock.app/devnet";
export const SOLANA_MAINNET_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL ||
  "https://rpc.magicblock.app/mainnet";

export const MAGICBLOCK_DEVNET_ENDPOINT =
  process.env.NEXT_PUBLIC_EPHEMERAL_PROVIDER_ENDPOINT ||
  "https://devnet-as.magicblock.app/";
export const MAGICBLOCK_MAINNET_ENDPOINT = "https://as.magicblock.app";
export const MAGICBLOCK_DEVNET_US_ENDPOINT = "https://devnet-us.magicblock.app";
export const MAGICBLOCK_MAINNET_US_ENDPOINT = "https://us.magicblock.app";

function isKnownPresetEndpoint(endpoint: string): boolean {
  return [
    SOLANA_DEVNET_ENDPOINT,
    SOLANA_MAINNET_ENDPOINT,
    MAGICBLOCK_DEVNET_ENDPOINT,
    MAGICBLOCK_MAINNET_ENDPOINT,
    MAGICBLOCK_DEVNET_US_ENDPOINT,
    MAGICBLOCK_MAINNET_US_ENDPOINT,
  ].includes(endpoint);
}

function isMagicBlockEndpoint(endpoint: string): boolean {
  return [
    MAGICBLOCK_DEVNET_ENDPOINT,
    MAGICBLOCK_MAINNET_ENDPOINT,
    MAGICBLOCK_DEVNET_US_ENDPOINT,
    MAGICBLOCK_MAINNET_US_ENDPOINT,
  ].includes(endpoint);
}

// Map endpoints to Solana endpoints for delegation status checking. Always
// returns a base-layer Solana RPC (delegation state only lives there), even
// for custom/unknown endpoints.
export function getSolanaEndpoint(endpoint: string): string {
  // Check for devnet first (devnet-as.magicblock.app, devnet-us.magicblock.app, etc)
  if (endpoint.includes("devnet")) {
    return SOLANA_DEVNET_ENDPOINT;
  }
  // Check for mainnet (mainnet, as.magicblock.app, us.magicblock.app, etc)
  else if (
    endpoint.includes("mainnet") ||
    endpoint.includes("as.magicblock.app") ||
    endpoint.includes("us.magicblock.app")
  ) {
    return SOLANA_MAINNET_ENDPOINT;
  }
  // Default to devnet
  else {
    return SOLANA_DEVNET_ENDPOINT;
  }
}

/**
 * Base-layer Solana RPC for reads: MagicBlock endpoints map to their paired
 * Solana cluster; custom endpoints are used as-is.
 */
export function getBaseLayerSolanaEndpoint(endpoint: string): string {
  return endpoint.includes("magicblock.app")
    ? getSolanaEndpoint(endpoint)
    : endpoint;
}

/**
 * Given the currently selected RPC endpoint and a desired layer ("solana" base
 * layer or "magicblock" ER), resolve the correct endpoint to submit to.
 * Custom endpoints that don't match known presets are returned unchanged.
 */
export function resolveEndpoint(
  selectedEndpoint: string,
  mode: AdminActionEndpointMode,
): string {
  if (!selectedEndpoint || !isKnownPresetEndpoint(selectedEndpoint)) {
    return selectedEndpoint;
  }
  if (mode === "solana") {
    return isMagicBlockEndpoint(selectedEndpoint)
      ? getBaseLayerSolanaEndpoint(selectedEndpoint)
      : selectedEndpoint;
  }
  if (isMagicBlockEndpoint(selectedEndpoint)) {
    return selectedEndpoint;
  }
  // A Solana preset is selected — pair it with the ER cluster that matches it
  return selectedEndpoint === SOLANA_MAINNET_ENDPOINT
    ? MAGICBLOCK_MAINNET_ENDPOINT
    : MAGICBLOCK_DEVNET_ENDPOINT;
}
