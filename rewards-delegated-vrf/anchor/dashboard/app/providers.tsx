"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TorusWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import {
  getDefaultSolanaEndpoint,
  loadRpcEndpointPreference,
  RPC_ENDPOINT_CHANGED_EVENT,
  RPC_ENDPOINT_STORAGE_KEY,
} from "@/lib/clusterContext";

require("@solana/wallet-adapter-react-ui/styles.css");

// Suppress hydration warning for wallet adapter
const HydrationSuppressed = ({ children }: { children: React.ReactNode }) => (
  <div suppressHydrationWarning>{children}</div>
);

/**
 * Get the RPC endpoint, preferring saved cluster preference over env var
 */
function getEndpoint(): string {
  const savedEndpoint = loadRpcEndpointPreference();
  if (savedEndpoint) {
    return savedEndpoint;
  }
  return getDefaultSolanaEndpoint();
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [endpoint, setEndpoint] = useState(getEndpoint);

  useEffect(() => {
    const syncEndpoint = () => {
      setEndpoint(getEndpoint());
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === RPC_ENDPOINT_STORAGE_KEY) {
        syncEndpoint();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(RPC_ENDPOINT_CHANGED_EVENT, syncEndpoint);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(RPC_ENDPOINT_CHANGED_EVENT, syncEndpoint);
    };
  }, []);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new TorusWalletAdapter(),
    ],
    []
  );

  return (
    <HydrationSuppressed>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </HydrationSuppressed>
  );
}
