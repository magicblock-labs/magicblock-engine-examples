import { useState, useEffect } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { PROGRAM_ID } from "@/lib/constants";

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

      console.log("Discovering distributors on endpoint:", connection.rpcEndpoint);

      let accounts = [];
      
      try {
        // Try with a strict size limit first
        accounts = await connection.getProgramAccounts(PROGRAM_ID, {
          filters: [
            {
              dataSize: { min: 41, max: 10000 }, // Reasonable size for typical distributors
            },
          ],
        });
        console.log(`Found ${accounts.length} distributor accounts with size filter`);
      } catch (err) {
        console.warn("Size-filtered fetch failed, trying without size filter:", err);
        
        try {
            // Fallback: fetch without size filter
            accounts = await connection.getProgramAccounts(PROGRAM_ID);
            console.log(`Found ${accounts.length} potential distributor accounts (unfiltered)`);
            
            accounts.forEach((acc, idx) => {
              console.log(`  [${idx}] Account: ${acc.pubkey.toString()}, Size: ${acc.account.data.length} bytes`);
            });
            
            // Filter to reasonable sizes locally
            accounts = accounts.filter(acc => {
              const size = acc.account.data.length;
              return size >= 41 && size <= 10000;
            });
            console.log(`After local filtering: ${accounts.length} accounts`);
        } catch (fallbackErr) {
          console.error("Failed to fetch program accounts even without filter:", fallbackErr);
          return;
        }
      }

      console.log(`Processing ${accounts.length} potential distributor accounts`);

      const discovered: DiscoveredDistributor[] = [];

      // Check each account to see if user is admin or whitelisted
      for (const account of accounts) {
        try {
          const data = account.account.data;
          
          // Ensure minimum size
          if (data.length < 41) {
            console.debug(`Account ${account.pubkey.toString()} too small (${data.length} bytes), skipping`);
            continue;
          }

          // Validate buffer before processing
          if (!Buffer.isBuffer(data)) {
            console.debug(`Account ${account.pubkey.toString()} data is not a buffer, skipping`);
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
            console.debug(`Account ${account.pubkey.toString()} has invalid bump ${bump}, skipping`);
            continue;
          }

          // Read admins vec length (must have at least 4 more bytes)
          if (data.length < pos + 4) {
            console.debug(`Account ${account.pubkey.toString()} too short to read admins length`);
            continue;
          }
          const adminsLength = data.readUInt32LE(pos);
          pos += 4;

          // Safety check: don't read more admins than possible
          if (adminsLength > 1000 || adminsLength < 0) {
            console.debug(`Account ${account.pubkey.toString()} has invalid admins length: ${adminsLength}`);
            continue;
          }
          
          const admins: PublicKey[] = [];
          for (let i = 0; i < adminsLength; i++) {
            if (data.length < pos + 32) {
              console.debug(`Account ${account.pubkey.toString()} truncated while reading admin ${i}`);
              break;
            }
            admins.push(new PublicKey(data.slice(pos, pos + 32)));
            pos += 32;
          }

          // Read whitelist vec length
          if (data.length < pos + 4) {
            console.debug(`Account ${account.pubkey.toString()} too short to read whitelist length`);
            continue;
          }
          const whitelistLength = data.readUInt32LE(pos);
          pos += 4;

          // Safety check: don't read more whitelisted than possible
          if (whitelistLength > 10000 || whitelistLength < 0) {
            console.debug(`Account ${account.pubkey.toString()} has invalid whitelist length: ${whitelistLength}`);
            continue;
          }
          
          const whitelist: PublicKey[] = [];
          for (let i = 0; i < whitelistLength; i++) {
            if (data.length < pos + 32) {
              console.debug(`Account ${account.pubkey.toString()} truncated while reading whitelist entry ${i}`);
              break;
            }
            whitelist.push(new PublicKey(data.slice(pos, pos + 32)));
            pos += 32;
          }

          // Check if user is admin or whitelisted
          const isAdmin = superAdmin.equals(userPublicKey) || admins.some(admin => admin.equals(userPublicKey));
          const isWhitelisted = whitelist.some(addr => addr.equals(userPublicKey));

          console.log(`Account ${account.pubkey.toString()}: isAdmin=${isAdmin}, isWhitelisted=${isWhitelisted}, adminsLength=${admins.length}, whitelistLength=${whitelist.length}`);

          if (isAdmin || isWhitelisted) {
            console.log(`Found ${isAdmin ? 'ADMIN' : 'WHITELISTED'} distributor: ${account.pubkey.toString()}`, {
              isAdmin,
              isWhitelisted,
              whitelistLength: whitelist.length,
              adminsLength: admins.length,
            });
            discovered.push({
              publicKey: account.pubkey,
              superAdmin,
              admins,
              whitelist,
              isAdmin,
              isWhitelisted,
            });
          } else {
            console.log(`Account ${account.pubkey.toString()} skipped - user not in admin or whitelist`);
          }
        } catch (err) {
          // Skip accounts that can't be decoded
          console.debug(`Failed to decode distributor account ${account.pubkey.toString()}:`, err);
          continue;
        }
      }

      // Sort by: admin first, then whitelisted, then by address
      discovered.sort((a, b) => {
        if (a.isAdmin !== b.isAdmin) return b.isAdmin ? 1 : -1;
        if (a.isWhitelisted !== b.isWhitelisted) return b.isWhitelisted ? 1 : -1;
        return a.publicKey.toString().localeCompare(b.publicKey.toString());
      });

      console.log(`Discovered ${discovered.length} distributors where user is admin or whitelisted`, discovered);
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
    const timer = setTimeout(() => {
      discoverDistributors();
    }, 500); // Debounce the discovery

    return () => clearTimeout(timer);
  }, [userPublicKey, connection.rpcEndpoint]);

  return { distributors, loading, error, refetch: discoverDistributors };
};
