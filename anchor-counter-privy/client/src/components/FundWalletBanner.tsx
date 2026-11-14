import React, {useState} from 'react';
import {LAMPORTS_PER_SOL} from '@solana/web3.js';

interface FundWalletBannerProps {
    address: string;
    balanceLamports: number;
    onRefresh: () => void;
}

const FundWalletBanner: React.FC<FundWalletBannerProps> = ({address, balanceLamports, onRefresh}) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const short = `${address.slice(0, 4)}...${address.slice(-4)}`;

    return (
        <div className="fund-banner">
            <div className="fund-banner-title">Fund Your Session Wallet</div>
            <p className="fund-banner-desc">
                Send at least <strong>0.05 SOL</strong> to this address to pay transaction fees.
            </p>
            <div className="fund-banner-address">
                <span className="fund-banner-addr-text" title={address}>{short}</span>
                <button className="fund-banner-copy" onClick={handleCopy}>
                    {copied ? 'Copied!' : 'Copy'}
                </button>
            </div>
            <div className="fund-banner-balance">
                Balance: {(balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
            </div>
            <button className="fund-banner-refresh" onClick={onRefresh}>Refresh</button>
        </div>
    );
};

export default FundWalletBanner;
