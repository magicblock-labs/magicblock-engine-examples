// Step-by-step wizard view: visualizes delegation state, guides user
// through fund → mint → transfer → delegate/undelegate → queue setup.
//
// Designed to sit on top of existing App.tsx handlers via the WizardCtx prop.

import React, {useMemo, useState} from "react";
import {Connection, LAMPORTS_PER_SOL, PublicKey} from "@solana/web3.js";
import {useWallet} from "@solana/wallet-adapter-react";
import {WalletMultiButton} from "@solana/wallet-adapter-react-ui";

type TempAccount = {
    keypair: { publicKey: PublicKey };
    ata?: PublicKey;
    eAta?: PublicKey;
    balance?: bigint;
    eBalance?: bigint;
    solLamports?: bigint;
    eDelegated?: boolean;
};

export type WizardCtx = {
    // state
    accounts: TempAccount[];
    mint: PublicKey | null;
    decimals: number;
    connection: Connection;
    ephemeralEndpoint?: string;
    baseEndpoint?: string;
    validator?: PublicKey;
    isSubmitting: boolean;
    transactionError: string | null;
    transactionSuccess: string | null;
    lastTxSignature?: {sig: string; isEr: boolean} | null;
    lastTxContext?: string | null;
    walletConnectedBalance?: number | null; // lamports
    useToken2022: boolean;
    setUseToken2022: (enabled: boolean) => void;
    activeUseToken2022: boolean;

    // step ui state
    srcIndex: number;
    setSrcIndex: (i: number) => void;
    dstIndex: number;
    setDstIndex: (i: number) => void;
    amountStr: string;
    setAmountStr: (s: string) => void;
    transferVisibility: 'public' | 'private';
    setTransferVisibility: (v: 'public' | 'private') => void;
    fromBalance: 'base' | 'ephemeral';
    setFromBalance: (v: 'base' | 'ephemeral') => void;
    toBalance: 'base' | 'ephemeral';
    setToBalance: (v: 'base' | 'ephemeral') => void;
    delegateAmounts: string[];
    setDelegateAmounts: (xs: string[]) => void;
    undelegateAmounts: string[];
    setUndelegateAmounts: (xs: string[]) => void;

    // handlers
    handleFundFromWallet: () => Promise<void>;
    setupAll: () => Promise<void>;
    handleSetupQueue: () => Promise<void>;
    handleStartQueueCrank: () => Promise<void>;
    handleTransfer: () => Promise<void>;
    handleDelegateAt: (i: number, amountStr: string) => Promise<void>;
    handleUndelegateAt: (i: number, amountStr: string) => Promise<void>;
    refreshBalances: () => Promise<void>;
    onSwitchToAdvanced: () => void;
};

// ---------- style atoms ----------
const SHELL: React.CSSProperties = {
    maxWidth: 1100,
    margin: "0 auto",
    padding: 24,
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto",
    color: "#e5e7eb",
};
const CARD: React.CSSProperties = {
    background: "linear-gradient(180deg, rgba(17,24,39,0.95), rgba(11,18,32,0.95))",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: 20,
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
    position: "relative",        // so absolute-positioned TxBanner can anchor here
};
const STEP_TITLE: React.CSSProperties = {fontSize: 18, fontWeight: 700, color: "#f1f5f9"};
const STEP_DESC: React.CSSProperties = {fontSize: 13, color: "#94a3b8", lineHeight: 1.5};
const BTN: React.CSSProperties = {
    height: 40,
    padding: "0 18px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 14,
    background: "linear-gradient(90deg,#22d3ee,#06b6d4)",
    color: "#0b1220",
};
const BTN_DEL: React.CSSProperties = {
    ...BTN,
    background: "linear-gradient(90deg,#a78bfa,#7c3aed)",
};
const BTN_GHOST: React.CSSProperties = {
    ...BTN,
    background: "transparent",
    color: "#e5e7eb",
};
const INPUT: React.CSSProperties = {
    height: 36,
    padding: "0 10px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(17,24,39,0.6)",
    color: "#e5e7eb",
    fontFamily: "inherit",
    fontSize: 13,
    outline: "none",
};
// ---------- helpers ----------
const fmt = (v?: bigint, decimals: number = 6): string => {
    if (v === undefined) return "…";
    const neg = v < 0n;
    const abs = neg ? -v : v;
    const s = abs.toString().padStart(decimals + 1, "0");
    const whole = s.slice(0, -decimals);
    const frac = s.slice(-decimals).replace(/0+$/, "");
    return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
};
const shortPk = (pk: PublicKey): string => {
    const s = pk.toBase58();
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
};
const shortSig = (sig: string): string => `${sig.slice(0, 6)}…${sig.slice(-6)}`;
const solStr = (lamports?: bigint): string => {
    if (lamports === undefined) return "…";
    return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4);
};

// Build a Solana Explorer URL with the right cluster for either base layer or ER.
// For base RPCs that are public (devnet/testnet/mainnet) we use the named cluster;
// otherwise we fall back to the `custom` cluster with the actual RPC URL.
const explorerUrl = (sig: string, rpcUrl?: string): string => {
    if (!rpcUrl) return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
    const named =
        rpcUrl.includes("api.devnet.solana.com") ? "devnet" :
        rpcUrl.includes("api.testnet.solana.com") ? "testnet" :
        rpcUrl.includes("api.mainnet-beta.solana.com") ? "mainnet-beta" :
        rpcUrl.includes("rpc.magicblock.app/devnet") ? "devnet" : // MagicBlock devnet proxy → same data as devnet
        null;
    if (named) return `https://explorer.solana.com/tx/${sig}?cluster=${named}`;
    return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;
};

// ---------- copyable address (click-to-copy) ----------
const CopyableAddress: React.FC<{
    text: string;
    display: string;
    color?: string;
    fontSize?: number;
}> = ({text, display, color = "#e5e7eb", fontSize = 11}) => {
    const [copied, setCopied] = useState(false);
    const doCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
            document.body.removeChild(ta);
        }
    };
    return (
        <span
            onClick={doCopy}
            title={copied ? "Copied!" : `Click to copy: ${text}`}
            style={{
                fontFamily: "monospace",
                fontSize,
                color: copied ? "#6ee7b7" : color,
                cursor: "pointer",
                userSelect: "none",
                padding: "1px 4px",
                margin: "-1px -4px",
                borderRadius: 4,
                transition: "background 0.15s",
                background: copied ? "rgba(16,185,129,0.12)" : "transparent",
            }}
            onMouseEnter={(e) => {
                if (!copied) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={(e) => {
                if (!copied) (e.currentTarget as HTMLElement).style.background = "transparent";
            }}>
            {copied ? "✓ Copied" : display}
        </span>
    );
};

// ---------- per-side pocket picker (Base / ER) ----------
const PocketPicker: React.FC<{
    label: string;
    accountIdx: number;
    onAccountChange: (i: number) => void;
    side: 'base' | 'ephemeral';
    onSideChange: (s: 'base' | 'ephemeral') => void;
    accounts: TempAccount[];
    decimals: number;
    disabled: boolean;
}> = ({label, accountIdx, onAccountChange, side, onSideChange, accounts, decimals, disabled}) => {
    const acc = accounts[accountIdx];
    const baseBal = acc ? fmt(acc.balance, decimals) : "…";
    const erBal = acc ? (acc.eDelegated ? fmt(acc.eBalance, decimals) : "—") : "…";
    return (
        <div style={{display: "flex", flexDirection: "column", gap: 4, minWidth: 0}}>
            <div style={{fontSize: 11, color: "#94a3b8"}}>{label}</div>
            <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6}}>
                <select
                    value={accountIdx}
                    onChange={e => onAccountChange(Number(e.target.value))}
                    disabled={disabled}
                    style={{...INPUT, padding: "0 8px", minWidth: 0}}>
                    {accounts.map((_, i) => <option key={`acct-${i}`} value={i}>Account #{i + 1}</option>)}
                </select>
                <select
                    value={side}
                    onChange={e => onSideChange(e.target.value as 'base' | 'ephemeral')}
                    disabled={disabled}
                    style={{...INPUT, padding: "0 8px", minWidth: 0}}>
                    <option value="base">Base · {baseBal}</option>
                    <option value="ephemeral">ER · {erBal}</option>
                </select>
            </div>
        </div>
    );
};

// ---------- full transfer step (visibility toggle drives layout) ----------
const TransferControls: React.FC<{ctx: WizardCtx}> = ({ctx}) => {
    const mintReady = !!ctx.mint;
    const disabled = !mintReady || ctx.isSubmitting;
    const isPublic = ctx.transferVisibility === 'public';

    // When switching to Public, force same-layer (Public only supports ER→ER and Base→Base).
    // Default to the current source side so user sees the natural mapping.
    React.useEffect(() => {
        if (isPublic && ctx.toBalance !== ctx.fromBalance) {
            ctx.setToBalance(ctx.fromBalance);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPublic, ctx.fromBalance]);

    const path = `${ctx.fromBalance === 'ephemeral' ? 'ER' : 'Base'} → ${ctx.toBalance === 'ephemeral' ? 'ER' : 'Base'}`;
    const pathDescription = (() => {
        const isErEr = ctx.fromBalance === 'ephemeral' && ctx.toBalance === 'ephemeral';
        const isErBase = ctx.fromBalance === 'ephemeral' && ctx.toBalance === 'base';
        const isBaseEr = ctx.fromBalance === 'base' && ctx.toBalance === 'ephemeral';
        const isBaseBase = ctx.fromBalance === 'base' && ctx.toBalance === 'base';
        if (isBaseBase) {
            return isPublic
                ? "Regular SPL transfer on Solana. Neither account needs to be delegated. Visible immediately."
                : "Shuttle + queue: tokens deposit into a shuttle on base layer, flow through the ER queue with delay + split, settle to recipient's base ATA. Timing + amount obfuscation.";
        }
        if (isErEr) {
            return "Direct SPL transfer on the rollup. Both accounts must be delegated. Visible immediately.";
        }
        if (isErBase) {
            return "Queue deposit on ER. The validator's crank settles to the recipient's base ATA asynchronously (optional delay + split).";
        }
        if (isBaseEr) {
            return "Shuttle on base layer deposits, delegates to the recipient's eATA on ER. Recipient becomes delegated.";
        }
        return "";
    })();

    return (
        <div style={{display: "flex", flexDirection: "column", gap: 14, marginTop: 8}}>
            {/* 1. Visibility first (mode picker) */}
            <div>
                <div style={{fontSize: 11, color: "#94a3b8", marginBottom: 6}}>Mode</div>
                <VisibilityToggle
                    value={ctx.transferVisibility}
                    onChange={ctx.setTransferVisibility}
                    anyDelegated={true}
                />
            </div>

            {/* 2. Side picker — shared for Public (same layer both ends), split for Private */}
            {isPublic ? (
                <SharedLayerPicker
                    side={ctx.fromBalance}
                    onSideChange={(s) => { ctx.setFromBalance(s); ctx.setToBalance(s); }}
                    disabled={disabled}
                />
            ) : null}

            {/* 3. Account pickers */}
            <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12}}>
                {isPublic ? (
                    <>
                        <SimpleAccountPicker
                            label={`From (${ctx.fromBalance === 'ephemeral' ? 'ER' : 'Base'})`}
                            accountIdx={ctx.srcIndex}
                            onAccountChange={ctx.setSrcIndex}
                            side={ctx.fromBalance}
                            accounts={ctx.accounts}
                            decimals={ctx.decimals}
                            disabled={disabled}
                        />
                        <SimpleAccountPicker
                            label={`To (${ctx.toBalance === 'ephemeral' ? 'ER' : 'Base'})`}
                            accountIdx={ctx.dstIndex}
                            onAccountChange={ctx.setDstIndex}
                            side={ctx.toBalance}
                            accounts={ctx.accounts}
                            decimals={ctx.decimals}
                            disabled={disabled}
                        />
                    </>
                ) : (
                    <>
                        <PocketPicker
                            label="From (any pocket)"
                            accountIdx={ctx.srcIndex}
                            onAccountChange={ctx.setSrcIndex}
                            side={ctx.fromBalance}
                            onSideChange={ctx.setFromBalance}
                            accounts={ctx.accounts}
                            decimals={ctx.decimals}
                            disabled={disabled}
                        />
                        <PocketPicker
                            label="To (any pocket)"
                            accountIdx={ctx.dstIndex}
                            onAccountChange={ctx.setDstIndex}
                            side={ctx.toBalance}
                            onSideChange={ctx.setToBalance}
                            accounts={ctx.accounts}
                            decimals={ctx.decimals}
                            disabled={disabled}
                        />
                    </>
                )}
            </div>

            {/* 4. Amount + send button */}
            {(() => {
                // Block only when source pocket === destination pocket (true no-op).
                // Same account / different side is allowed — it's a deposit/withdraw to yourself.
                const samePocket = ctx.srcIndex === ctx.dstIndex && ctx.fromBalance === ctx.toBalance;
                const sendDisabled = disabled || samePocket;
                return (
                    <div style={{display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "end"}}>
                        <label style={{display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#94a3b8"}}>
                            Amount
                            <input
                                type="number"
                                min={0}
                                step={1}
                                value={ctx.amountStr}
                                onChange={e => ctx.setAmountStr(e.target.value)}
                                disabled={disabled}
                                style={INPUT}/>
                        </label>
                        <button
                            onClick={ctx.handleTransfer}
                            disabled={sendDisabled}
                            title={samePocket ? "Source and destination are the same pocket — pick different account or side." : ""}
                            style={{
                                ...BTN,
                                opacity: sendDisabled ? 0.5 : 1,
                                cursor: sendDisabled ? "not-allowed" : "pointer",
                            }}>
                            Send {path}
                        </button>
                    </div>
                );
            })()}

            {/* 5. Path description card */}
            <div style={{
                fontSize: 12,
                color: "#94a3b8",
                background: "rgba(0,0,0,0.2)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 6,
                padding: "8px 10px",
                lineHeight: 1.5,
            }}>
                <span style={{color: "#e5e7eb", fontWeight: 600}}>{path}</span>
                <span style={{
                    marginLeft: 8,
                    fontSize: 11,
                    color: isPublic ? "#22d3ee" : "#a78bfa",
                    fontWeight: 600,
                }}>
                    ({isPublic ? "🌐 Public" : "🔒 Private"})
                </span>
                <div style={{marginTop: 4}}>{pathDescription}</div>
            </div>
        </div>
    );
};

// Public-mode helper: one layer picker controls both ends
const SharedLayerPicker: React.FC<{
    side: 'base' | 'ephemeral';
    onSideChange: (s: 'base' | 'ephemeral') => void;
    disabled: boolean;
}> = ({side, onSideChange, disabled}) => (
    <div>
        <div style={{fontSize: 11, color: "#94a3b8", marginBottom: 6}}>Layer (Public — both ends must match)</div>
        <div style={{display: "inline-flex", gap: 0, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: 3}}>
            {(['base', 'ephemeral'] as const).map((s) => (
                <button
                    key={s}
                    type="button"
                    onClick={() => !disabled && onSideChange(s)}
                    disabled={disabled}
                    style={{
                        background: side === s ? "rgba(34,211,238,0.18)" : "transparent",
                        border: "none",
                        color: side === s ? "#e5e7eb" : "#94a3b8",
                        padding: "6px 14px",
                        fontSize: 12,
                        fontWeight: 600,
                        borderRadius: 6,
                        cursor: disabled ? "not-allowed" : "pointer",
                    }}>
                    {s === 'base' ? '🟦 Base' : '🟪 Ephemeral Rollup'}
                </button>
            ))}
        </div>
    </div>
);

// Public-mode helper: account picker without side selector (side controlled by SharedLayerPicker)
const SimpleAccountPicker: React.FC<{
    label: string;
    accountIdx: number;
    onAccountChange: (i: number) => void;
    side: 'base' | 'ephemeral';
    accounts: TempAccount[];
    decimals: number;
    disabled: boolean;
}> = ({label, accountIdx, onAccountChange, side, accounts, decimals, disabled}) => {
    const balFor = (a: TempAccount) =>
        side === 'base'
            ? fmt(a.balance, decimals)
            : (a.eDelegated ? fmt(a.eBalance, decimals) : "—");
    return (
        <div style={{display: "flex", flexDirection: "column", gap: 4, minWidth: 0}}>
            <div style={{fontSize: 11, color: "#94a3b8"}}>{label}</div>
            <select
                value={accountIdx}
                onChange={e => onAccountChange(Number(e.target.value))}
                disabled={disabled}
                style={{...INPUT, padding: "0 8px", minWidth: 0}}>
                {accounts.map((a, i) => (
                    <option key={`acct-${i}`} value={i}>
                        Account #{i + 1} · {balFor(a)}
                    </option>
                ))}
            </select>
        </div>
    );
};

// ---------- public/private segmented toggle ----------
const VisibilityToggle: React.FC<{
    value: 'public' | 'private';
    onChange: (v: 'public' | 'private') => void;
    anyDelegated: boolean;
    disabled?: boolean;
    disabledReason?: string;
}> = ({value, onChange, anyDelegated, disabled = false, disabledReason}) => {
    const isPublic = value === 'public';
    return (
        <div style={{marginTop: 4, opacity: disabled ? 0.55 : 1}}>
            <div style={{display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap"}}>
                <div style={{
                    display: "inline-flex",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 999,
                    padding: 3,
                    position: "relative",
                }}>
                    {/* sliding pill */}
                    <div style={{
                        position: "absolute",
                        top: 3,
                        bottom: 3,
                        left: isPublic ? 3 : "calc(50% + 0px)",
                        width: "calc(50% - 3px)",
                        borderRadius: 999,
                        background: isPublic
                            ? "linear-gradient(90deg,#22d3ee,#06b6d4)"
                            : "linear-gradient(90deg,#a78bfa,#7c3aed)",
                        transition: "left 0.18s ease, background 0.18s ease",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
                    }}/>
                    <button
                        type="button"
                        onClick={() => !disabled && onChange('public')}
                        disabled={disabled}
                        style={{
                            position: "relative",
                            zIndex: 1,
                            background: "transparent",
                            border: "none",
                            padding: "6px 18px",
                            fontSize: 13,
                            fontWeight: 700,
                            color: isPublic ? "#0b1220" : "#cbd5e1",
                            cursor: disabled ? "not-allowed" : "pointer",
                            transition: "color 0.15s",
                        }}>
                        🌐 Public
                    </button>
                    <button
                        type="button"
                        onClick={() => !disabled && onChange('private')}
                        disabled={disabled}
                        style={{
                            position: "relative",
                            zIndex: 1,
                            background: "transparent",
                            border: "none",
                            padding: "6px 18px",
                            fontSize: 13,
                            fontWeight: 700,
                            color: !isPublic ? "#0b1220" : "#cbd5e1",
                            cursor: disabled ? "not-allowed" : "pointer",
                            transition: "color 0.15s",
                        }}>
                        🔒 Private
                    </button>
                </div>
                <div style={{fontSize: 12, color: "#94a3b8", flex: 1, minWidth: 200}}>
                    {disabledReason
                        ? <span style={{fontStyle: "italic"}}>{disabledReason}</span>
                        : isPublic
                            ? "Direct transfer in one tx. Visible immediately on chain."
                            : "Deposits into the ER transfer queue. Crank settles asynchronously with optional delay + amount splitting (Legacy view)."
                    }
                </div>
            </div>
            {!disabled && !isPublic && !anyDelegated && (
                <div style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: "#fbbf24",
                    background: "rgba(251,191,36,0.08)",
                    border: "1px solid rgba(251,191,36,0.25)",
                    borderRadius: 6,
                    padding: "6px 10px",
                }}>
                    ⚠ Private transfers require at least one delegated account.
                </div>
            )}
        </div>
    );
};

// ---------- CLI funding (copy bash commands) ----------
const CliFundingSection: React.FC<{
    accounts: TempAccount[];
}> = ({accounts}) => {
    const [open, setOpen] = useState(false);
    const [copiedAll, setCopiedAll] = useState(false);
    const lines = useMemo(
        () => accounts.map(a => `solana transfer ${a.keypair.publicKey.toBase58()} 0.1 --allow-unfunded-recipient`),
        [accounts],
    );
    const allCmds = lines.join("\n");
    const copyAll = async () => {
        try {
            await navigator.clipboard.writeText(allCmds);
            setCopiedAll(true);
            setTimeout(() => setCopiedAll(false), 1200);
        } catch {}
    };
    return (
        <div style={{marginTop: 14}}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    background: "transparent",
                    border: "none",
                    color: "#94a3b8",
                    fontSize: 12,
                    cursor: "pointer",
                    padding: 0,
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                }}>
                <span style={{display: "inline-block", transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)"}}>▸</span>
                Or fund via Solana CLI ({accounts.length} commands)
            </button>
            {open && (
                <div style={{marginTop: 8}}>
                    <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6}}>
                        <div style={{fontSize: 11, color: "#94a3b8"}}>
                            Uses whichever cluster <code style={{background: "rgba(255,255,255,0.06)", padding: "1px 4px", borderRadius: 3}}>solana config</code> is set to. Run <code style={{background: "rgba(255,255,255,0.06)", padding: "1px 4px", borderRadius: 3}}>solana config get</code> to check.
                        </div>
                        <button
                            onClick={copyAll}
                            style={{
                                background: copiedAll ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.06)",
                                border: "1px solid rgba(255,255,255,0.12)",
                                color: copiedAll ? "#6ee7b7" : "#cbd5e1",
                                fontSize: 11,
                                fontWeight: 600,
                                padding: "4px 10px",
                                borderRadius: 4,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                            }}>
                            {copiedAll ? "✓ Copied all" : "Copy all"}
                        </button>
                    </div>
                    <pre style={{
                        background: "rgba(0,0,0,0.35)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "#e5e7eb",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                        fontSize: 11,
                        padding: 12,
                        borderRadius: 6,
                        margin: 0,
                        overflowX: "auto",
                        lineHeight: 1.5,
                    }}>{allCmds}</pre>
                </div>
            )}
        </div>
    );
};

// ---------- toast notification fixed at bottom-right of viewport ----------
const TxBanner: React.FC<{
    ctx: WizardCtx;
    match?: string; // if provided, only renders when ctx.lastTxContext matches; otherwise always renders when there's a message
}> = ({ctx, match}) => {
    const matches = match
        ? ctx.lastTxContext === match && (!!ctx.transactionSuccess || !!ctx.transactionError)
        : !!ctx.transactionSuccess || !!ctx.transactionError;
    const [visible, setVisible] = useState(false);
    const [closing, setClosing] = useState(false);

    React.useEffect(() => {
        if (!matches) {
            setVisible(false);
            setClosing(false);
            return;
        }
        setVisible(true);
        setClosing(false);
        const isErr = !!ctx.transactionError;
        // Errors hang around longer so the user can read + click the explorer link.
        const lifetimeMs = isErr ? 9000 : 4500;
        const fadeMs = 220;
        const closeAt = setTimeout(() => setClosing(true), lifetimeMs - fadeMs);
        const removeAt = setTimeout(() => { setVisible(false); setClosing(false); }, lifetimeMs);
        return () => { clearTimeout(closeAt); clearTimeout(removeAt); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [matches, ctx.transactionSuccess, ctx.transactionError, ctx.lastTxSignature?.sig]);

    if (!visible || !matches) return null;
    const isErr = !!ctx.transactionError;
    const {transactionSuccess, transactionError, lastTxSignature, baseEndpoint, ephemeralEndpoint} = ctx;

    return (
        <div style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            maxWidth: "min(420px, calc(100vw - 48px))",
            zIndex: 1000,
            background: isErr ? "rgba(127,29,29,0.95)" : "rgba(6,78,59,0.95)",
            border: `1px solid ${isErr ? "rgba(239,68,68,0.55)" : "rgba(16,185,129,0.55)"}`,
            color: isErr ? "#fecaca" : "#bbf7d0",
            backdropFilter: "blur(8px)",
            padding: "12px 16px",
            borderRadius: 10,
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
            opacity: closing ? 0 : 1,
            transform: closing ? "translateY(12px)" : "translateY(0)",
            transition: "opacity 0.22s ease, transform 0.22s ease",
            pointerEvents: closing ? "none" : "auto",
            boxSizing: "border-box",
        }}>
            <span style={{flex: "1 1 auto"}}>
                <span style={{fontWeight: 700, marginRight: 6}}>{isErr ? "✗ Error:" : "✓"}</span>
                {transactionError ?? transactionSuccess}
            </span>
            {lastTxSignature && (
                <>
                    <span style={{opacity: 0.5}}>·</span>
                    <CopyableAddress
                        text={lastTxSignature.sig}
                        display={shortSig(lastTxSignature.sig)}
                        color={isErr ? "#fecaca" : "#bbf7d0"}
                        fontSize={12}/>
                    <a
                        href={explorerUrl(
                            lastTxSignature.sig,
                            lastTxSignature.isEr ? ephemeralEndpoint : baseEndpoint,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            color: isErr ? "#fca5a5" : "#86efac",
                            textDecoration: "underline",
                            fontSize: 12,
                        }}>
                        Explorer →
                    </a>
                </>
            )}
            <button
                type="button"
                onClick={() => { setClosing(true); setTimeout(() => setVisible(false), 220); }}
                aria-label="Dismiss"
                style={{
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    fontSize: 16,
                    lineHeight: 1,
                    padding: "0 2px",
                    opacity: 0.7,
                }}>
                ×
            </button>
        </div>
    );
};

// (removed FallbackBanner — a single global <TxBanner ctx={ctx}/> at the top of WizardView
// handles every context now that banners are fixed bottom-right.)

// ---------- step header ----------
const StepHeader: React.FC<{
    num: number;
    title: string;
    description?: string;
    state: "done" | "current" | "locked";
}> = ({num, title, description, state}) => {
    const colors = state === "done"
        ? {bg: "#10b981", txt: "#0b1220"}
        : state === "current"
            ? {bg: "linear-gradient(90deg,#22d3ee,#a78bfa)", txt: "#0b1220"}
            : {bg: "#374151", txt: "#9ca3af"};
    return (
        <div style={{display: "flex", alignItems: "center", gap: 12, marginBottom: 8}}>
            <div style={{
                width: 32, height: 32, borderRadius: 999,
                background: colors.bg, color: colors.txt as string,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: 14, flexShrink: 0,
            }}>
                {state === "done" ? "✓" : num}
            </div>
            <div style={{display: "flex", flexDirection: "column"}}>
                <div style={STEP_TITLE}>{title}</div>
                {description && <div style={STEP_DESC}>{description}</div>}
            </div>
        </div>
    );
};

// ---------- account card ----------
const AccountCard: React.FC<{
    idx: number;
    acc: TempAccount;
    decimals: number;
    amount: string;
    onAmountChange: (s: string) => void;
    onDelegate: () => void;
    onUndelegate: () => void;
    isSubmitting: boolean;
    mintReady: boolean;
    ctx: WizardCtx;
}> = ({
          idx, acc, decimals,
          amount, onAmountChange,
          onDelegate, onUndelegate,
          isSubmitting, mintReady,
          ctx,
      }) => {
    const pk = acc.keypair.publicKey;
    const sol = solStr(acc.solLamports);
    const hasSol = (acc.solLamports ?? 0n) > 0n;
    const baseBal = fmt(acc.balance, decimals);
    const erBal = acc.eDelegated ? fmt(acc.eBalance, decimals) : "-";
    const isDelegated = !!acc.eDelegated;

    const accentColor = !hasSol
        ? "#6b7280"
        : isDelegated
            ? "linear-gradient(180deg,#10b981,#059669)"
            : "linear-gradient(180deg,#22d3ee,#0891b2)";

    return (
        <div style={{
            ...CARD,
            padding: 14,
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 220,
        }}>
            {/* accent bar */}
            <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
                borderTopLeftRadius: 14, borderBottomLeftRadius: 14,
                background: accentColor,
            }}/>
            {/* header: account number + click-to-copy address */}
            <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6}}>
                <div style={{fontWeight: 700, fontSize: 13, color: "#f1f5f9"}}>
                    Account #{idx + 1}
                </div>
                <CopyableAddress text={pk.toBase58()} display={shortPk(pk)} color="#94a3b8"/>
            </div>
            {/* SOL */}
            <div style={{display: "flex", flexDirection: "column", alignItems: "center", marginTop: 2}}>
                <div style={{fontSize: 11, color: "#9ca3af"}}>SOL</div>
                <div style={{fontWeight: 700, color: "#fbbf24", fontSize: 16}}>{sol}</div>
            </div>
            {/* SPL + Ephemeral SPL side by side */}
            <div style={{display: "flex", justifyContent: "space-between", padding: "0 4px"}}>
                <div>
                    <div style={{fontSize: 11, color: "#9ca3af"}}>SPL</div>
                    <div style={{fontWeight: 700, color: "#22d3ee", fontSize: 16}}>{baseBal}</div>
                </div>
                <div style={{textAlign: "right"}}>
                    <div style={{fontSize: 11, color: "#9ca3af"}}>Ephemeral SPL</div>
                    <div style={{fontWeight: 700, color: "#a78bfa", fontSize: 16}}>{erBal}</div>
                </div>
            </div>
            {/* delegation status text (green/red, like legacy view) */}
            <div style={{
                display: "flex", justifyContent: "center", alignItems: "center",
                fontWeight: 700, fontSize: 13,
                color: !hasSol ? "#6b7280" : isDelegated ? "#34d399" : "#f87171",
            }}>
                {!hasSol ? "Not funded yet" : isDelegated ? "eATA Delegated" : "eATA Not Delegated"}
            </div>
            {/* action row — amount + both buttons; each enabled per its own precondition */}
            <div style={{marginTop: "auto", display: "flex", flexDirection: "column", gap: 6}}>
                <input
                    type="number"
                    min={0}
                    step={1}
                    placeholder="amount"
                    value={amount}
                    onChange={e => onAmountChange(e.target.value)}
                    style={{...INPUT, height: 32, fontSize: 12}}
                    disabled={!mintReady || isSubmitting}
                />
                <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6}}>
                    {(() => {
                        const canDelegate = mintReady && !isSubmitting && (acc.balance ?? 0n) > 0n;
                        const canUndelegate = mintReady && !isSubmitting && (acc.eBalance ?? 0n) > 0n;
                        return (
                            <>
                                <button
                                    onClick={onDelegate}
                                    disabled={!canDelegate}
                                    title={!canDelegate && (acc.balance ?? 0n) === 0n ? "No base-layer balance to delegate" : ""}
                                    style={{
                                        ...BTN,
                                        height: 32, fontSize: 12, padding: "0 8px",
                                        opacity: canDelegate ? 1 : 0.4,
                                        cursor: canDelegate ? "pointer" : "not-allowed",
                                    }}>
                                    Delegate
                                </button>
                                <button
                                    onClick={onUndelegate}
                                    disabled={!canUndelegate}
                                    title={!canUndelegate && (acc.eBalance ?? 0n) === 0n ? "No ER balance to undelegate" : ""}
                                    style={{
                                        ...BTN_DEL,
                                        height: 32, fontSize: 12, padding: "0 8px",
                                        opacity: canUndelegate ? 1 : 0.4,
                                        cursor: canUndelegate ? "pointer" : "not-allowed",
                                    }}>
                                    Undelegate
                                </button>
                            </>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
};

// ---------- main wizard ----------
export const WizardView: React.FC<{ctx: WizardCtx}> = ({ctx}) => {
    const wallet = useWallet();
    const walletConnected = wallet.connected && !!wallet.publicKey;

    // derive per-step state
    const accountsFunded = useMemo(
        () => ctx.accounts.length > 0 && ctx.accounts.every(a => (a.solLamports ?? 0n) > 0n),
        [ctx.accounts]
    );
    const mintReady = !!ctx.mint;

    const stepState = (
        prereq: boolean,
        done: boolean,
    ): "done" | "current" | "locked" => {
        if (done) return "done";
        if (!prereq) return "locked";
        return "current";
    };

    return (
        <div style={SHELL}>
            {/* Top bar */}
            <div style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 24,
                flexWrap: "wrap",
            }}>
                <div style={{minWidth: 0, flex: "1 1 280px"}}>
                    <div style={{fontSize: 22, fontWeight: 800, letterSpacing: -0.4}}>
                        SPL Tokens on the Ephemeral Rollup
                    </div>
                    <div style={{fontSize: 13, color: "#94a3b8", marginTop: 4, lineHeight: 1.5}}>
                        Demo for how SPL tokens move between base and ER. On a <span style={{color: "#a78bfa", fontWeight: 600}}>TEE-backed ER</span>, the state is private.
                    </div>
                </div>
                <button
                    onClick={ctx.onSwitchToAdvanced}
                    style={{
                        ...BTN_GHOST,
                        height: 32,
                        fontSize: 12,
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                        alignSelf: "flex-start",
                    }}>
                    Legacy view
                </button>
            </div>

            {/* Single global toast fixed at bottom-right of viewport */}
            <TxBanner ctx={ctx}/>

            {/* Step 1 — Fund demo accounts (wallet OR CLI) */}
            <div style={{...CARD, marginBottom: 16}}>
                <StepHeader
                    num={1}
                    title="Fund demo accounts"
                    description={`Each of the ${ctx.accounts.length} local accounts needs ~0.1 SOL to cover base-layer fees. Pick either path below.`}
                    state={stepState(true, accountsFunded)}
                />

                {/* Path A — Connect wallet + fund */}
                <div style={{
                    marginTop: 12,
                    padding: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    background: "rgba(34,211,238,0.05)",
                }}>
                    <div style={{fontSize: 12, color: "#22d3ee", fontWeight: 700, marginBottom: 8, letterSpacing: 0.4}}>
                        OPTION A — CONNECT WALLET
                    </div>
                    <div style={{display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap"}}>
                        <style>{`
                            .wallet-adapter-compact .wallet-adapter-button {
                                height: 40px !important;
                                padding: 0 18px !important;
                                font-size: 14px !important;
                                font-weight: 700 !important;
                                line-height: 1 !important;
                                border-radius: 8px !important;
                            }
                            .wallet-adapter-compact .wallet-adapter-button-start-icon,
                            .wallet-adapter-compact .wallet-adapter-button-end-icon {
                                width: 18px !important;
                                height: 18px !important;
                            }
                        `}</style>
                        <div className="wallet-adapter-compact">
                            <WalletMultiButton/>
                        </div>
                        {walletConnected && wallet.publicKey && (
                            <div style={{fontSize: 13, color: "#94a3b8", display: "flex", alignItems: "center", gap: 8}}>
                                <CopyableAddress text={wallet.publicKey.toBase58()} display={shortPk(wallet.publicKey)} fontSize={13}/>
                                {ctx.walletConnectedBalance != null && (
                                    <span>· {(ctx.walletConnectedBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL</span>
                                )}
                            </div>
                        )}
                        <button
                            onClick={ctx.handleFundFromWallet}
                            disabled={!walletConnected || ctx.isSubmitting || accountsFunded}
                            style={{
                                ...BTN,
                                opacity: (!walletConnected || ctx.isSubmitting || accountsFunded) ? 0.5 : 1,
                                cursor: (!walletConnected || ctx.isSubmitting || accountsFunded) ? "not-allowed" : "pointer",
                            }}>
                            {accountsFunded ? "Already funded" : "Fund via connected wallet"}
                        </button>
                    </div>
                </div>

                {/* Path B — CLI */}
                <div style={{
                    marginTop: 10,
                    padding: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    background: "rgba(167,139,250,0.04)",
                }}>
                    <div style={{fontSize: 12, color: "#a78bfa", fontWeight: 700, marginBottom: 4, letterSpacing: 0.4}}>
                        OPTION B — SOLANA CLI
                    </div>
                    <CliFundingSection accounts={ctx.accounts}/>
                </div>

                {/* Refresh */}
                <div style={{marginTop: 12}}>
                    <button
                        onClick={ctx.refreshBalances}
                        disabled={ctx.isSubmitting}
                        style={{...BTN_GHOST, height: 36, fontSize: 12, opacity: ctx.isSubmitting ? 0.5 : 1}}>
                        Refresh balances
                    </button>
                </div>
            </div>

            {/* Step 2 — Create mint */}
            <div style={{...CARD, marginBottom: 16}}>
                <StepHeader
                    num={2}
                    title="Create SPL mint + initialize queue & vault"
                    description="Creates a new mint, ATAs for all 4 accounts, mints 500 tokens each, and initializes the transfer queue + crank required for private transfers."
                    state={stepState(accountsFunded, mintReady)}
                />
                <div style={{display: "flex", alignItems: "center", gap: 12, marginTop: 8}}>
                    <button
                        onClick={ctx.setupAll}
                        disabled={!accountsFunded || ctx.isSubmitting || mintReady}
                        style={{
                            ...BTN,
                            opacity: (!accountsFunded || ctx.isSubmitting || mintReady) ? 0.5 : 1,
                            cursor: (!accountsFunded || ctx.isSubmitting || mintReady) ? "not-allowed" : "pointer",
                        }}>
                        {mintReady ? "Mint ready" : "Setup mint"}
                    </button>
                    <label
                        title={mintReady ? "Reset the mint to choose a different token program" : "Create the mint with the Token-2022 program"}
                        style={{
                            minHeight: 40,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            color: "#94a3b8",
                            fontSize: 12,
                            cursor: (mintReady || ctx.isSubmitting) ? "not-allowed" : "pointer",
                            opacity: (mintReady || ctx.isSubmitting) ? 0.55 : 1,
                            userSelect: "none",
                        }}>
                        <input
                            type="checkbox"
                            checked={ctx.useToken2022}
                            onChange={e => ctx.setUseToken2022(e.target.checked)}
                            disabled={mintReady || ctx.isSubmitting}
                            style={{width: 16, height: 16, margin: 0}}
                        />
                        Use Token-2022
                    </label>
                    {mintReady && ctx.mint && (
                        <div style={{fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap"}}>
                            <span>Mint:</span>
                            <CopyableAddress text={ctx.mint.toBase58()} display={shortPk(ctx.mint)} fontSize={12}/>
                            <span>· {ctx.decimals} decimals</span>
                            <span>· {ctx.activeUseToken2022 ? "Token-2022" : "SPL Token"}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Step 3 — Accounts + Transfer */}
            <div style={{...CARD, marginBottom: 16}}>
                <StepHeader
                    num={3}
                    title="Accounts & transfer"
                    description="Each account has two pockets (Base and ER). Delegate/Undelegate moves tokens between them. Use the form below the cards to transfer between accounts."
                    state={stepState(mintReady, false)}
                />

                {/* Per-account cards */}
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 12,
                    marginTop: 16,
                    marginBottom: 16,
                }}>
                    {ctx.accounts.map((acc, i) => (
                        <AccountCard
                            key={acc.keypair.publicKey.toBase58()}
                            idx={i}
                            acc={acc}
                            decimals={ctx.decimals}
                            amount={ctx.delegateAmounts[i] ?? "1"}
                            onAmountChange={(s) => {
                                const next = ctx.delegateAmounts.slice();
                                next[i] = s;
                                ctx.setDelegateAmounts(next);
                            }}
                            onDelegate={() => ctx.handleDelegateAt(i, ctx.delegateAmounts[i] ?? "")}
                            onUndelegate={() => ctx.handleUndelegateAt(i, ctx.delegateAmounts[i] ?? "")}
                            isSubmitting={ctx.isSubmitting}
                            mintReady={mintReady}
                            ctx={ctx}
                        />
                    ))}
                </div>

                {/* Divider */}
                <div style={{
                    height: 1,
                    background: "rgba(255,255,255,0.08)",
                    margin: "8px 0 16px",
                }}/>

                {/* Transfer controls */}
                <div style={{fontSize: 13, fontWeight: 600, color: "#e5e7eb", marginBottom: 4}}>
                    Transfer between accounts
                </div>
                <TransferControls ctx={ctx}/>
            </div>

            {/* Legend */}
            <div style={{...CARD, fontSize: 12, color: "#94a3b8"}}>
                <div style={{fontWeight: 600, color: "#e5e7eb", marginBottom: 8}}>How balances flow</div>
                <div style={{display: "flex", flexWrap: "wrap", gap: 16, lineHeight: 1.6}}>
                    <span><span style={{color: "#fbbf24", fontWeight: 700}}>SOL</span> — native lamports on the base layer (pays fees)</span>
                    <span><span style={{color: "#22d3ee", fontWeight: 700}}>SPL</span> — token balance on the base layer (Solana devnet)</span>
                    <span><span style={{color: "#a78bfa", fontWeight: 700}}>Ephemeral SPL</span> — token balance on the rollup (only when delegated)</span>
                </div>
            </div>

            {/* Troubleshooting — small, collapsible, not numbered */}
            <Troubleshooting ctx={ctx} mintReady={mintReady}/>
        </div>
    );
};

// ---------- troubleshooting (queue/crank rescue) ----------
const Troubleshooting: React.FC<{ctx: WizardCtx; mintReady: boolean}> = ({ctx, mintReady}) => {
    const [open, setOpen] = useState(false);
    return (
        <div style={{marginTop: 16}}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    background: "transparent",
                    border: "none",
                    color: "#94a3b8",
                    fontSize: 12,
                    cursor: "pointer",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                }}>
                <span style={{display: "inline-block", transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)"}}>▸</span>
                Troubleshooting (queue & crank rescue)
            </button>
            {open && (
                <div style={{
                    marginTop: 8,
                    padding: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    background: "rgba(0,0,0,0.2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                }}>
                    <div style={{fontSize: 12, color: "#94a3b8", lineHeight: 1.5}}>
                        Setup mint above already creates the queue and starts the crank. Only click these if a private transfer never settles or the queue gets stuck.
                    </div>
                    <div style={{display: "flex", gap: 8, flexWrap: "wrap"}}>
                        <button
                            onClick={ctx.handleSetupQueue}
                            disabled={!mintReady || ctx.isSubmitting}
                            style={{
                                ...BTN_GHOST,
                                height: 32, fontSize: 12,
                                opacity: (!mintReady || ctx.isSubmitting) ? 0.5 : 1,
                                cursor: (!mintReady || ctx.isSubmitting) ? "not-allowed" : "pointer",
                            }}>
                            Re-init transfer queue
                        </button>
                        <button
                            onClick={ctx.handleStartQueueCrank}
                            disabled={!mintReady || ctx.isSubmitting}
                            style={{
                                ...BTN_GHOST,
                                height: 32, fontSize: 12,
                                opacity: (!mintReady || ctx.isSubmitting) ? 0.5 : 1,
                                cursor: (!mintReady || ctx.isSubmitting) ? "not-allowed" : "pointer",
                            }}>
                            Start crank
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
