import React, {FC, ReactNode, useMemo, useState, useEffect} from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import {
    WalletModalProvider,
} from '@solana/wallet-adapter-react-ui';
import {Connection, PublicKey} from '@solana/web3.js';
import {PhantomWalletAdapter, SolflareWalletAdapter} from "@solana/wallet-adapter-wallets";
import {Provider} from "@coral-xyz/anchor";

// Default styles that can be overridden by your app
require('@solana/wallet-adapter-react-ui/styles.css');

interface WalletProps {
    app: ReactNode;
}

export class SimpleProvider implements Provider {
    readonly connection: Connection;
    readonly publicKey?: PublicKey;

    constructor(connection: Connection, publicKey?: PublicKey) {
        this.connection = connection;
        this.publicKey = publicKey;
    }
}

export const Wallet: FC<WalletProps> = ({ app }) => {
    const devnetEndpoint = "https://rpc.magicblock.app/devnet";
    const mainnetEndpoint = "https://rpc.magicblock.app/mainnet";

    const [endpoint, setEndpoint] = useState(() => {
        const savedEndpoint = localStorage.getItem('solana-endpoint');
        return savedEndpoint || devnetEndpoint;
    });

    useEffect(() => {
        console.log(`Endpoint changed to: ${endpoint}`);
        localStorage.setItem('solana-endpoint', endpoint);
    }, [endpoint]);

    const wallets = useMemo(() => [
        new PhantomWalletAdapter(),
        new SolflareWalletAdapter(),
    ], []);

    return (
        <ConnectionProvider endpoint={endpoint} key={endpoint}>
            <div className="network-selection" style={{textAlign: 'center', marginBottom: '20px', color: 'gray', marginTop: '20px'}}>
                <label>
                    <input
                        type="radio"
                        value="mainnet-beta"
                        checked={endpoint === mainnetEndpoint}
                        style={{marginRight: '10px'}}
                        onChange={() => setEndpoint(mainnetEndpoint)}
                    />
                    Mainnet
                </label>
                <label style={{marginLeft: '20px'}}>
                    <input
                        type="radio"
                        value="devnet"
                        checked={endpoint === devnetEndpoint}
                        style={{marginRight: '10px'}}
                        onChange={() => setEndpoint(devnetEndpoint)}
                    />
                    Devnet
                </label>
            </div>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    {app}
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};