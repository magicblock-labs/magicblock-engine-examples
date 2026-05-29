import React, {FC, ReactNode} from 'react';
import {ConnectionProvider} from '@solana/wallet-adapter-react';
import {Connection, PublicKey} from '@solana/web3.js';
import {Provider} from "@coral-xyz/anchor";
import {PrivyProvider} from '@privy-io/react-auth';

export class SimpleProvider implements Provider {
    readonly connection: Connection;
    readonly publicKey?: PublicKey;

    constructor(connection: Connection, publicKey?: PublicKey) {
        this.connection = connection;
        this.publicKey = publicKey;
    }
}

export const Wallet: FC<{ app: ReactNode }> = ({ app }) => {
    const endpoint = process.env.REACT_APP_PROVIDER_ENDPOINT || "https://api.devnet.solana.com";
    const privyAppId = process.env.REACT_APP_PRIVY_APP_ID || '';

    return (
        <PrivyProvider
            appId={privyAppId}
            config={{
                loginMethods: ['email', 'google', 'wallet'],
                embeddedWallets: {
                    solana: {
                        createOnLogin: 'all-users',
                    },
                    showWalletUIs: false,
                },
            }}
        >
            <ConnectionProvider endpoint={endpoint}>
                {app}
            </ConnectionProvider>
        </PrivyProvider>
    );
};
