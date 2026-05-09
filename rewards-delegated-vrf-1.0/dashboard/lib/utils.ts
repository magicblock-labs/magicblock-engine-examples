/**
 * Utility functions for the dashboard
 */

import { PublicKey } from "@solana/web3.js";

/**
 * Shorten a public key for display
 */
export function shortAddress(address: PublicKey | string, chars = 4): string {
  const addr = address instanceof PublicKey ? address.toString() : address;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      return success;
    }
  } catch {
    return false;
  }
}

/**
 * Open transaction explorer link
 */
export function openExplorer(
  signature: string,
  network: "devnet" | "mainnet-beta" | "custom" = "devnet"
): void {
  const baseUrl = `https://explorer.solana.com`;
  const networkParam = network === "devnet" ? "?cluster=devnet" : "";
  const url = `${baseUrl}/tx/${signature}${networkParam}`;

  window.open(url, "_blank");
}

/**
 * Format lamports to SOL
 */
export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000;
}

/**
 * Format SOL to lamports
 */
export function solToLamports(sol: number): number {
  return sol * 1_000_000_000;
}

/**
 * Validate Solana address format
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate transaction signature format
 */
export function isValidSignature(signature: string): boolean {
  // Base58 signature should be 88 characters
  return /^[1-9A-HJ-NP-Z]{88}$/.test(signature);
}

/**
 * Format large numbers with commas
 */
export function formatNumber(num: number, decimals = 2): string {
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Convert timestamp to readable date
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

/**
 * Convert readable date to timestamp
 */
export function dateToTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts) {
        const delay = delayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error("All retry attempts failed");
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn(...args);
    }
  };
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(
  json: string,
  fallback: T
): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Merge objects recursively
 */
export function deepMerge<T extends object>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (
        sourceValue !== null &&
        typeof sourceValue === "object" &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === "object" &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(
          targetValue as object,
          sourceValue as object
        ) as any;
      } else {
        result[key] = sourceValue as any;
      }
    }
  }

  return result;
}

/**
 * Truncate address for display
 */
export function truncateAddress(address: string, chars = 4): string {
  return shortAddress(address, chars);
}

/**
 * Get redemption percentage
 */
export function getRedemptionPercentage(
  redemptionCount: number | bigint,
  redemptionLimit: number | bigint
): number {
  const count = typeof redemptionCount === "bigint" ? Number(redemptionCount) : redemptionCount;
  const limit = typeof redemptionLimit === "bigint" ? Number(redemptionLimit) : redemptionLimit;
  if (limit === 0) return 0;
  return Math.round((count / limit) * 100);
}

/**
 * Get reward type name
 */
function normalizeRewardType(type: unknown): string | number | null {
  if (typeof type === "string" || typeof type === "number") {
    return type;
  }

  if (type && typeof type === "object") {
    const keys = Object.keys(type as Record<string, unknown>);
    return keys.length > 0 ? keys[0] : null;
  }

  return null;
}

export function getRewardTypeName(type: unknown): string {
  const types: Record<string | number, string> = {
    "0": "SPL Token",
    "1": "Legacy NFT",
    "2": "Programmable NFT",
    "3": "SPL Token 2022",
    "4": "Compressed NFT",
    "splToken": "SPL Token",
    "legacyNft": "Legacy NFT",
    "programmableNft": "Programmable NFT",
    "splToken2022": "SPL Token 2022",
    "compressedNft": "Compressed NFT",
  };
  const normalizedType = normalizeRewardType(type);
  return normalizedType != null ? types[normalizedType] || "Unknown" : "Unknown";
}

/**
 * Get reward type color for display
 */
export function getRewardTypeColor(type: unknown): string {
  const colors: Record<string | number, string> = {
    "0": "bg-blue-500",
    "1": "bg-purple-500",
    "2": "bg-pink-500",
    "3": "bg-cyan-500",
    "4": "bg-green-500",
    "splToken": "bg-blue-500",
    "legacyNft": "bg-purple-500",
    "programmableNft": "bg-pink-500",
    "splToken2022": "bg-cyan-500",
    "compressedNft": "bg-green-500",
  };
  const normalizedType = normalizeRewardType(type);
  return normalizedType != null ? colors[normalizedType] || "bg-gray-500" : "bg-gray-500";
}
