import { PublicKey } from "@solana/web3.js";

// The SDK's lib/index.d.ts re-exports from src/ paths that aren't included in
// the published package, so TypeScript can't resolve getAuthToken via the main
// entry. This augmentation adds the missing declaration directly.
declare module "@magicblock-labs/ephemeral-rollups-sdk" {
    export const SESSION_DURATION: number;
    export function getAuthToken(
        rpcUrl: string,
        publicKey: PublicKey,
        signMessage: (message: Uint8Array) => Promise<Uint8Array>
    ): Promise<{ token: string; expiresAt: number }>;
}
