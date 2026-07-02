import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import App from "./App";
import { BASE_ENDPOINT } from "./lib/config";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles.css";

// wallets=[] — wallets implementing the Wallet Standard (Phantom, Solflare,
// Backpack, …) register themselves automatically.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={BASE_ENDPOINT}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>,
);
