export type AdminActionEndpointMode = "solana" | "magicblock";

export const SOLANA_DEVNET_ENDPOINT = "https://rpc.magicblock.app/devnet";
export const SOLANA_MAINNET_ENDPOINT = "https://rpc.magicblock.app/mainnet";
export const MAGICBLOCK_DEVNET_ENDPOINT =
  process.env.NEXT_PUBLIC_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app/";
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

function isSolanaEndpoint(endpoint: string): boolean {
  return endpoint === SOLANA_DEVNET_ENDPOINT || endpoint === SOLANA_MAINNET_ENDPOINT;
}

export function isDevnetEndpoint(endpoint: string): boolean {
  return endpoint.includes("devnet");
}

export function isMainnetEndpoint(endpoint: string): boolean {
  return (
    endpoint.includes("mainnet") ||
    endpoint.includes("as.magicblock.app") ||
    endpoint === MAGICBLOCK_MAINNET_US_ENDPOINT
  );
}

/**
 * Given the currently selected RPC endpoint and a desired layer ("solana" base
 * layer or "magicblock" ER), resolve the correct endpoint to submit to.
 * Custom endpoints that don't match known presets are returned unchanged.
 */
export function resolveEndpoint(
  selectedEndpoint: string,
  mode: AdminActionEndpointMode
): string {
  if (!selectedEndpoint || !isKnownPresetEndpoint(selectedEndpoint)) {
    return selectedEndpoint;
  }
  if (mode === "magicblock") {
    if (isMagicBlockEndpoint(selectedEndpoint)) return selectedEndpoint;
    if (isDevnetEndpoint(selectedEndpoint)) return MAGICBLOCK_DEVNET_ENDPOINT;
    if (isMainnetEndpoint(selectedEndpoint)) return MAGICBLOCK_MAINNET_ENDPOINT;
  }
  if (mode === "solana") {
    if (isSolanaEndpoint(selectedEndpoint)) return selectedEndpoint;
    if (isDevnetEndpoint(selectedEndpoint)) return SOLANA_DEVNET_ENDPOINT;
    if (isMainnetEndpoint(selectedEndpoint)) return SOLANA_MAINNET_ENDPOINT;
  }
  return selectedEndpoint;
}
