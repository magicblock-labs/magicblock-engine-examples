"use client";

import React, { useMemo } from "react";
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
import { clusterApiUrl } from "@solana/web3.js";

require("@solana/wallet-adapter-react-ui/styles.css");

// Suppress hydration warning for wallet adapter
const HydrationSuppressed = ({ children }: { children: React.ReactNode }) => (
  <div suppressHydrationWarning>{children}</div>
);

/**
 * Get the RPC endpoint, preferring saved cluster preference over env var
 */
function getEndpoint(): string {
  if (typeof window !== "undefined") {
    const savedEndpoint = localStorage.getItem("solana-rpc-endpoint");
    if (savedEndpoint) {
      return savedEndpoint;
    }
  }
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("devnet");
}

export function Providers({ children }: { children: React.ReactNode }) {
  const network = getEndpoint();
  const endpoint = useMemo(() => network, [network]);

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
