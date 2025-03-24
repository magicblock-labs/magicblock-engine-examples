import * as React from "react";
import { WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { Keypair } from "@solana/web3.js";
import { MagicBlockEngine } from "./MagicBlockEngine";

const SESSION_LOCAL_STORAGE = "magicblock-session-key";
const SESSION_MIN_LAMPORTS = 0.02 * 1_000_000_000;
const SESSION_MAX_LAMPORTS = 0.05 * 1_000_000_000;

const MagicBlockEngineContext = React.createContext<MagicBlockEngine>(
  {} as MagicBlockEngine
);

export function useMagicBlockEngine(): MagicBlockEngine {
  return React.useContext(MagicBlockEngineContext);
}

export function MagicBlockEngineProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WalletProvider wallets={[]} autoConnect>
      <MagicBlockEngineProviderInner>{children}</MagicBlockEngineProviderInner>
    </WalletProvider>
  );
}

function MagicBlockEngineProviderInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const walletContext = useWallet();

  const engine = React.useMemo(() => {
    let sessionKey;

    const sessionKeyString = localStorage.getItem(SESSION_LOCAL_STORAGE);
    if (sessionKeyString) {
      sessionKey = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(sessionKeyString))
      );
    } else {
      sessionKey = Keypair.generate();
      localStorage.setItem(
        SESSION_LOCAL_STORAGE,
        JSON.stringify(Array.from(sessionKey.secretKey))
      );
    }

    return new MagicBlockEngine(walletContext, sessionKey, {
      minLamports: SESSION_MIN_LAMPORTS,
      maxLamports: SESSION_MAX_LAMPORTS,
    });
  }, [walletContext]);

  return (
    <MagicBlockEngineContext.Provider value={engine}>
      {children}
    </MagicBlockEngineContext.Provider>
  );
}
