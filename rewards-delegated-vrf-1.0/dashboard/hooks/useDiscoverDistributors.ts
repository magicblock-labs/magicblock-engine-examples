import { useState, useEffect } from "react";
import { AccountInfo, PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { PROGRAM_ID } from "@/lib/constants";
import { DASHBOARD_DATA_REFRESH_EVENT } from "@/lib/refresh";

export interface DiscoveredDistributor {
  publicKey: PublicKey;
  superAdmin: PublicKey;
  admins: PublicKey[];
  whitelist: PublicKey[];
  isAdmin: boolean;
  isWhitelisted: boolean;
}

export const useDiscoverDistributors = (userPublicKey: PublicKey | null) => {
  const { connection } = useConnection();
  const [distributors, setDistributors] = useState<DiscoveredDistributor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discoverDistributors = async () => {
    if (!userPublicKey) {
      setDistributors([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      let accounts: Array<{
        pubkey: PublicKey;
        account: AccountInfo<Buffer>;
      }> = [];
      
      try {
        accounts = [...(await connection.getProgramAccounts(PROGRAM_ID))];
        
        // Filter to reasonable sizes locally
        accounts = accounts.filter((acc) => {
          const size = acc.account.data.length;
          return size >= 41 && size <= 10000;
        });
      } catch (err) {
        console.error("Failed to fetch program accounts:", err);
        return;
      }

      const discovered: DiscoveredDistributor[] = [];

      // Check each account to see if user is admin or whitelisted
      for (const account of accounts) {
        try {
          const data = account.account.data;
          
          // Ensure minimum size
          if (data.length < 41) {
            continue;
          }

          // Validate buffer before processing
          if (!Buffer.isBuffer(data)) {
            continue;
          }
          
          let pos = 8; // Skip discriminator

          // Read super_admin (32 bytes)
          const superAdmin = new PublicKey(data.slice(pos, pos + 32));
          pos += 32;

          // Read bump (1 byte)
          const bump = data[pos];
          pos += 1;

          // Validate bump is reasonable (should be 1-255)
          if (bump === 0 || bump > 255) {
            continue;
          }

          // Read admins vec length (must have at least 4 more bytes)
          if (data.length < pos + 4) {
            continue;
          }
          const adminsLength = data.readUInt32LE(pos);
          pos += 4;

          // Safety check: don't read more admins than possible
          if (adminsLength > 1000 || adminsLength < 0) {
            continue;
          }
          
          const admins: PublicKey[] = [];
          for (let i = 0; i < adminsLength; i++) {
            if (data.length < pos + 32) {
              break;
            }
            admins.push(new PublicKey(data.slice(pos, pos + 32)));
            pos += 32;
          }

          // Read whitelist vec length
          if (data.length < pos + 4) {
            continue;
          }
          const whitelistLength = data.readUInt32LE(pos);
          pos += 4;

          // Safety check: don't read more whitelisted than possible
          if (whitelistLength > 10000 || whitelistLength < 0) {
            continue;
          }
          
          const whitelist: PublicKey[] = [];
          for (let i = 0; i < whitelistLength; i++) {
            if (data.length < pos + 32) {
              break;
            }
            whitelist.push(new PublicKey(data.slice(pos, pos + 32)));
            pos += 32;
          }

          // Check if user is admin or whitelisted
          const isAdmin = superAdmin.equals(userPublicKey) || admins.some(admin => admin.equals(userPublicKey));
          const isWhitelisted = whitelist.some(addr => addr.equals(userPublicKey));

          if (isAdmin || isWhitelisted) {
            discovered.push({
              publicKey: account.pubkey,
              superAdmin,
              admins,
              whitelist,
              isAdmin,
              isWhitelisted,
            });
          }
        } catch (err) {
          // Skip accounts that can't be decoded
          continue;
        }
      }

      // Sort by: admin first, then whitelisted, then by address
      discovered.sort((a, b) => {
        if (a.isAdmin !== b.isAdmin) return b.isAdmin ? 1 : -1;
        if (a.isWhitelisted !== b.isWhitelisted) return b.isWhitelisted ? 1 : -1;
        return a.publicKey.toString().localeCompare(b.publicKey.toString());
      });

      setDistributors(discovered);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to discover distributors";
      console.error("Error discovering distributors:", err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setDistributors([]);
    setError(null);

    if (!userPublicKey) {
      return;
    }

    const timer = setTimeout(() => {
      discoverDistributors();
    }, 500); // Debounce the discovery

    const handleRefresh = () => {
      void discoverDistributors();
    };

    window.addEventListener(DASHBOARD_DATA_REFRESH_EVENT, handleRefresh);

    return () => {
      clearTimeout(timer);
      window.removeEventListener(DASHBOARD_DATA_REFRESH_EVENT, handleRefresh);
    };
  }, [userPublicKey, connection.rpcEndpoint]);

  return { distributors, loading, error, refetch: discoverDistributors };
};
