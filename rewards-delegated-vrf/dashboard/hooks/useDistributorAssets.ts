import { useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

export interface DistributorAsset {
  type: "spl-token" | "nft" | "nft-collection";
  mint: PublicKey;
  name?: string;
  symbol?: string;
  balance?: number;
  decimals?: number;
  isInRewardList?: boolean;
  metadata?: {
    uri: string;
    symbol: string;
    name: string;
  };
}

export const useDistributorAssets = () => {
  const { connection } = useConnection();
  const [assets, setAssets] = useState<DistributorAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDistributorAssets = useCallback(
    async (rewardDistributorPda: PublicKey) => {
      setLoading(true);
      setError(null);

      try {
        const assetsData: DistributorAsset[] = [];

        // Get all token accounts owned by the distributor
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          rewardDistributorPda,
          { programId: new PublicKey("TokenkegQfeZyiNwAJsyFbPVwwQQYuU2exeJY4pocrA") }
        );

        for (const account of tokenAccounts.value) {
          const parsedData = account.account.data.parsed?.info;
          if (parsedData) {
            const mint = new PublicKey(parsedData.mint);
            const tokenAmount = parsedData.tokenAmount;

            // Try to fetch mint info for decimals
            try {
              const mintInfo = await connection.getParsedAccountInfo(mint);
              const mintData = mintInfo.value?.data as any;
              const decimals = mintData?.parsed?.info?.decimals || 0;

              assetsData.push({
                type: decimals === 0 ? "nft" : "spl-token",
                mint,
                balance: tokenAmount?.uiAmount || 0,
                decimals,
              });
            } catch {
              // If mint info fetch fails, add with default
              assetsData.push({
                type: "spl-token",
                mint,
                balance: tokenAmount?.uiAmount || 0,
                decimals: 0,
              });
            }
          }
        }

        setAssets(assetsData);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to fetch assets";
        setError(errorMessage);
        setAssets([]);
      } finally {
        setLoading(false);
      }
    },
    [connection]
  );

  const getAssetInfo = useCallback(
    async (mint: PublicKey): Promise<DistributorAsset | null> => {
      try {
        const mintInfo = await connection.getParsedAccountInfo(mint);
        const mintData = mintInfo.value?.data as any;

        if (!mintData?.parsed?.info) {
          return null;
        }

        const decimals = mintData.parsed.info.decimals;

        return {
          type: decimals === 0 ? "nft" : "spl-token",
          mint,
          decimals,
          symbol: mintData.parsed.info.symbol,
          name: mintData.parsed.info.name,
        };
      } catch {
        return null;
      }
    },
    [connection]
  );

  return {
    assets,
    loading,
    error,
    fetchDistributorAssets,
    getAssetInfo,
  };
};
