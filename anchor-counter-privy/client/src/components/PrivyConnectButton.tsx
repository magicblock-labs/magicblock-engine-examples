import React, {useState} from 'react';
import {usePrivy} from '@privy-io/react-auth';
import {LAMPORTS_PER_SOL} from '@solana/web3.js';

interface Props {
    address?: string;
    balanceLamports: number | null;
}

const PrivyConnectButton: React.FC<Props> = ({address, balanceLamports}) => {
    const {ready, authenticated, login, logout} = usePrivy();
    const [copied, setCopied] = useState(false);

    if (!ready) {
        return <button className="privy-btn" disabled>Loading…</button>;
    }

    if (!authenticated || !address) {
        return (
            <button className="privy-btn" onClick={login}>
                Connect Wallet
            </button>
        );
    }

    const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
    const sol = balanceLamports !== null
        ? `${(balanceLamports / LAMPORTS_PER_SOL).toFixed(3)} SOL`
        : '— SOL';

    const handleCopy = async () => {
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="privy-wallet-chip">
            <div className="privy-wallet-chip-info">
                <span
                    className="privy-wallet-chip-addr"
                    title={address}
                    onClick={handleCopy}
                >
                    {copied ? 'Copied!' : short}
                </span>
                <span className="privy-wallet-chip-balance">{sol}</span>
            </div>
            <button className="privy-btn privy-btn-sm" onClick={logout}>
                Disconnect
            </button>
        </div>
    );
};

export default PrivyConnectButton;
