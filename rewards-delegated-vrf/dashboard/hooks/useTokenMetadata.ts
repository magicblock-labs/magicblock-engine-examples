"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { TokenMetadata, NFTMetadata } from "@/lib/types";
import { ProgramClient } from "@/lib/program";

export function useTokenMetadata(mints: PublicKey[]) {
  const [metadata, setMetadata] = useState<Map<string, TokenMetadata>>(
    new Map()
  );
  const [nftMetadata, setNFTMetadata] = useState<Map<string, NFTMetadata>>(
    new Map()
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mints.length === 0) return;

    const fetchAll = async () => {
      setLoading(true);
      try {
        const client = new ProgramClient();
        const connection = client.getConnection();
        const newMetadata = new Map<string, TokenMetadata>();
        const newNFTMetadata = new Map<string, NFTMetadata>();

        for (const mint of mints) {
          const key = mint.toString();

          // Try to fetch token metadata
          try {
            const tokenInfo = await connection.getParsedAccountInfo(mint);
            if (tokenInfo.value && "data" in tokenInfo.value.data) {
              const parsedData = tokenInfo.value.data as any;
              const decimals = parsedData.parsed?.info?.decimals || 0;

              newMetadata.set(key, {
                mint,
                decimals,
                symbol: "TOKEN",
                name: key.substring(0, 8),
              });
              continue;
            }
          } catch (err) {
            // Fallback to NFT metadata
          }

          // Default NFT metadata
          newNFTMetadata.set(key, {
            mint,
            name: key.substring(0, 8),
          });
        }

        setMetadata(newMetadata);
        setNFTMetadata(newNFTMetadata);
      } catch (error) {
        console.error("Error fetching metadata:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [mints]);

  return { metadata, nftMetadata, loading };
}
