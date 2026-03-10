import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import * as anchor from "@coral-xyz/anchor";
import {useConnection} from '@solana/wallet-adapter-react';
import Alert from "./components/Alert";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    sendAndConfirmTransaction,
    Transaction,
    SystemProgram, TransactionInstruction, SYSVAR_RENT_PUBKEY, SendTransactionError
} from "@solana/web3.js";
import {
    DELEGATION_PROGRAM_ID,
    EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    GetCommitmentSignature,
    deriveEphemeralAta,
    deriveShuttleEphemeralAta,
    deriveShuttleAta,
    deriveShuttleWalletAta,
    deriveTransferQueue,
    deriveVault,
    deriveVaultAta,
    delegateTransferQueueIx,
    ensureTransferQueueCrankIx,
    initTransferQueueIx,
    mergeShuttleIntoAtaIx,
    undelegateAndCloseShuttleEphemeralAtaIx,
    undelegateIx,
    withdrawSplIx, delegateSpl
} from "@magicblock-labs/ephemeral-rollups-sdk";

// Minimal SPL helpers (vendored) to avoid importing "@solana/spl-token" in the browser.
const TOKEN_PROGRAM_ID = new PublicKey(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const MINT_SIZE = 82;

function getAssociatedTokenAddressSync(
    mint: PublicKey,
    owner: PublicKey,
    allowOwnerOffCurve: boolean = false,
    programId: PublicKey = TOKEN_PROGRAM_ID,
    associatedTokenProgramId: PublicKey = ASSOCIATED_TOKEN_PROGRAM_ID,
): PublicKey {
    if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
        throw new Error("Owner public key is off-curve");
    }
    const [ata] = PublicKey.findProgramAddressSync(
        [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
        associatedTokenProgramId,
    );
    return ata;
}

function createAssociatedTokenAccountInstruction(
    payer: PublicKey,
    associatedToken: PublicKey,
    owner: PublicKey,
    mint: PublicKey,
    programId: PublicKey = TOKEN_PROGRAM_ID,
    associatedTokenProgramId: PublicKey = ASSOCIATED_TOKEN_PROGRAM_ID,
): TransactionInstruction {
    return new TransactionInstruction({
        programId: associatedTokenProgramId,
        keys: [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: associatedToken, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: programId, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: Buffer.alloc(0),
    });
}

function createTransferInstruction(
    source: PublicKey,
    destination: PublicKey,
    owner: PublicKey,
    amount: bigint | number,
    multiSigners: PublicKey[] = [],
    programId: PublicKey = TOKEN_PROGRAM_ID,
): TransactionInstruction {
    const data = Buffer.alloc(9);
    data[0] = 3; // TokenInstruction::Transfer
    data.writeBigUInt64LE(BigInt(amount), 1);

    const keys = [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
    ];

    if (multiSigners.length === 0) {
        keys.push({ pubkey: owner, isSigner: true, isWritable: false });
    } else {
        keys.push({ pubkey: owner, isSigner: false, isWritable: false });
        for (const signer of multiSigners) {
            keys.push({ pubkey: signer, isSigner: true, isWritable: false });
        }
    }

    return new TransactionInstruction({
        programId,
        keys,
        data,
    });
}

function createDepositAndQueueTransferInstruction(
    queue: PublicKey,
    vault: PublicKey,
    mint: PublicKey,
    source: PublicKey,
    vaultAta: PublicKey,
    destination: PublicKey,
    owner: PublicKey,
    amount: bigint,
    delaySeconds: bigint = 0n,
    split: number = 1,
): TransactionInstruction {
    if (!Number.isInteger(split) || split <= 0 || split > 0xffff_ffff) {
        throw new Error('split must fit in u32');
    }

    const data = Buffer.alloc(21);
    data[0] = 16; // DepositAndQueueTransfer
    data.writeBigUInt64LE(amount, 1);
    data.writeBigUInt64LE(delaySeconds, 9);
    data.writeUInt32LE(split, 17);

    return new TransactionInstruction({
        programId: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        keys: [
            { pubkey: queue, isSigner: false, isWritable: true },
            { pubkey: vault, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: source, isSigner: false, isWritable: true },
            { pubkey: vaultAta, isSigner: false, isWritable: true },
            { pubkey: destination, isSigner: false, isWritable: false },
            { pubkey: owner, isSigner: true, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data,
    });
}

function createInitializeMintInstruction(
    mint: PublicKey,
    decimals: number,
    mintAuthority: PublicKey,
    freezeAuthority: PublicKey | null,
    programId: PublicKey = TOKEN_PROGRAM_ID,
): TransactionInstruction {
    const data = Buffer.alloc(67);
    data[0] = 0; // TokenInstruction::InitializeMint
    data[1] = decimals;
    mintAuthority.toBuffer().copy(data, 2);
    if (freezeAuthority) {
        data.writeUInt32LE(1, 34);
        freezeAuthority.toBuffer().copy(data, 38);
    } else {
        data.writeUInt32LE(0, 34);
    }

    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: mint, isSigner: false, isWritable: true },
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ],
        data,
    });
}

function createMintToInstruction(
    mint: PublicKey,
    destination: PublicKey,
    authority: PublicKey,
    amount: bigint | number,
    multiSigners: PublicKey[] = [],
    programId: PublicKey = TOKEN_PROGRAM_ID,
): TransactionInstruction {
    const data = Buffer.alloc(9);
    data[0] = 7; // TokenInstruction::MintTo
    data.writeBigUInt64LE(BigInt(amount), 1);

    const keys = [
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
    ];

    if (multiSigners.length === 0) {
        keys.push({ pubkey: authority, isSigner: true, isWritable: false });
    } else {
        keys.push({ pubkey: authority, isSigner: false, isWritable: false });
        for (const signer of multiSigners) {
            keys.push({ pubkey: signer, isSigner: true, isWritable: false });
        }
    }

    return new TransactionInstruction({
        programId,
        keys,
        data,
    });
}

async function getMint(
    connection: Connection,
    address: PublicKey,
    commitment?: "processed" | "confirmed" | "finalized",
    programId: PublicKey = TOKEN_PROGRAM_ID,
): Promise<{ decimals: number }> {
    const info = await connection.getAccountInfo(address, commitment);
    if (!info) throw new Error("Mint not found");
    if (!info.owner.equals(programId)) throw new Error("Invalid mint owner");
    if (info.data.length < MINT_SIZE) throw new Error("Invalid mint account size");
    // Mint layout decimals offset.
    return { decimals: info.data[44] };
}

async function getMinimumBalanceForRentExemptMint(
    connection: Connection,
): Promise<number> {
    return connection.getMinimumBalanceForRentExemption(MINT_SIZE);
}

type TempAccount = {
    keypair: Keypair;
    ata?: PublicKey; // Solana ATA
    eAta?: PublicKey; // Ephemeral ATA
    balance?: bigint; // Solana balance in base units
    eBalance?: bigint; // Ephemeral balance in base units
    solLamports?: bigint; // Native SOL balance in lamports
    // Delegation status on Ephemeral chain: true if eATA owner authority is DELEGATION_PROGRAM_ID
    eDelegated?: boolean;
};

const fmt = (v?: bigint, decimals: number = 6) => {
    if (v === undefined) return '…';
    const neg = v < 0n;
    const abs = neg ? -v : v;
    const s = abs.toString().padStart(decimals + 1, '0');
    const whole = s.slice(0, -decimals);
    const frac = s.slice(-decimals).replace(/0+$/, '');
    return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

const short = (pk: PublicKey) => {
    const s = pk.toBase58();
    // Show more characters (middle truncation) to occupy more horizontal space
    return `${s.slice(0, 12)}…${s.slice(-8)}`;
};

// Local storage helpers for persisting generated temp accounts
const LS_KEY = 'tempAccountsV1';
type StoredAccounts = { version: 1; keys: string[] };

// Persist a randomly created mint
const LS_MINT_KEY = 'tempMintV1';
type StoredMint = { version: 1; secret: string; pubkey: string; decimals: number };

export const BLOCKHASH_CACHE_MAX_AGE_MS = 30000

const toBase64 = (u8: Uint8Array): string => {
    if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
    let binary = '';
    for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
    return btoa(binary);
};

const fromBase64 = (b64: string): Uint8Array => {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
};

// Utility: Parse UI amount string to base units (bigint)
const parseAmount = (amountUi: string, decimals: number): bigint => {
    const [w, f = ''] = amountUi.trim().split('.');
    const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
    return BigInt(`${w || '0'}${frac}`);
};

const formatTransactionError = async (
    error: unknown,
    logsConnection?: Connection,
): Promise<string> => {
    const message = String((error as { message?: string } | null | undefined)?.message || error);

    if (error instanceof SendTransactionError && logsConnection) {
        try {
            const logs = await error.getLogs(logsConnection);
            if (logs && logs.length > 0) {
                return `${message}\nLogs:\n${logs.join('\n')}`;
            }
        } catch {
            // Ignore getLogs failures and keep the base message.
        }
    }

    return message;
};

// Utility: Create a noop instruction with random data to make transactions unique
const NOOP_PROGRAM_ID = new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
const createNoopInstruction = (): TransactionInstruction => new TransactionInstruction({
    programId: NOOP_PROGRAM_ID,
    keys: [],
    data: Buffer.from(crypto.getRandomValues(new Uint8Array(5))),
});

// Utility: Safe localStorage operations
const safeLocalStorage = {
    get: <T,>(key: string, defaultValue: T): T => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return defaultValue;
            const raw = window.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : defaultValue;
        } catch {
            return defaultValue;
        }
    },
    set: (key: string, value: any): void => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem(key, JSON.stringify(value));
            }
        } catch {
            // ignore
        }
    },
    remove: (key: string): void => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.removeItem(key);
            }
        } catch {
            // ignore
        }
    }
};

// Utility: Validate and clean numeric input for amounts
const cleanNumericInput = (value: string, decimals: number): string => {
    let v = value.replace(/[^0-9.]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) {
        const head = v.slice(0, firstDot + 1);
        const tail = v.slice(firstDot + 1).replace(/\./g, '');
        const [w, f = ''] = (head + tail).split('.');
        v = w + '.' + f.slice(0, Math.min(decimals, 6));
    }
    return v;
};

// Common styles
const CARD_STYLE = {
    background: 'linear-gradient(180deg, #0f172a 0%, #0b1220 100%)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 16,
    color: '#e5e7eb',
    boxShadow: '0 10px 25px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)'
} as const;

const INPUT_STYLE = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#e5e7eb',
    borderRadius: 6,
    padding: '8px 12px',
    outline: 'none',
} as const;

const BUTTON_STYLE = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#e5e7eb',
    borderRadius: 8,
    padding: '8px 12px',
    cursor: 'pointer',
} as const;

const App: React.FC = () => {
    const { connection } = useConnection();
    const ephemeralConnection = useRef<Connection | null>(null);
    const validator = useRef<PublicKey | undefined>(undefined);
    const accountsRef = useRef<TempAccount[]>([]);
    // Ensure auto-setup runs only once on first load when no mint is present
    const autoSetupTriggeredRef = useRef(false);

    type CachedBlockhash = {
        blockhash: string
        lastValidBlockHeight: number
        timestamp: number
    }

    // Config
    const [mint, setMint] = useState<PublicKey | null>(() => {
        const stored = safeLocalStorage.get<StoredMint | null>(LS_MINT_KEY, null);
        return stored?.version === 1 && stored.pubkey ? new PublicKey(stored.pubkey) : null;
    });
    const [decimals, setDecimals] = useState<number>(() => {
        const stored = safeLocalStorage.get<StoredMint | null>(LS_MINT_KEY, null);
        return stored?.version === 1 && typeof stored.decimals === 'number' ? stored.decimals : 6;
    });

    // Per-card delegate/undelegate input values (by index)
    const [delegateAmounts, setDelegateAmounts] = useState<string[]>([]);
    const [undelegateAmounts, setUndelegateAmounts] = useState<string[]>([]);

    // Temp accounts (persist across refresh via localStorage)
    const [accounts, setAccounts] = useState<TempAccount[]>(() => {
        const stored = safeLocalStorage.get<StoredAccounts | null>(LS_KEY, null);
        let list: TempAccount[] = [];

        if (stored?.version === 1 && Array.isArray(stored.keys)) {
            list = stored.keys.slice(0, 4).map(k => ({ keypair: Keypair.fromSecretKey(fromBase64(k)) }));
        }

        // Ensure exactly 4 accounts
        while (list.length < 4) {
            list.push({ keypair: Keypair.generate() });
        }

        // Persist to storage
        safeLocalStorage.set(LS_KEY, {
            version: 1,
            keys: list.map(a => toBase64(a.keypair.secretKey))
        });

        return list;
    });


    // Keep a ref to the latest accounts to avoid stale closures in callbacks
    useEffect(() => {
        accountsRef.current = accounts;
    }, [accounts]);

    // UI state
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [transactionError, setTransactionError] = useState<string | null>(null);
    const [transactionSuccess, setTransactionSuccess] = useState<string | null>(null);

    // Transfer form state
    const [srcIndex, setSrcIndex] = useState(0);
    const [dstIndex, setDstIndex] = useState(1);
    const [amountStr, setAmountStr] = useState('1');
    const [useEphemeral, setUseEphemeral] = useState(true);
    const [usePrivateTransfer, setUsePrivateTransfer] = useState(false);
    const [privateDelaySeconds, setPrivateDelaySeconds] = useState('0');
    const [privateSplitCount, setPrivateSplitCount] = useState('1');

    // Cached Blockhash
    const cachedEphemeralBlockhashRef = useRef<CachedBlockhash | null>(null)

    // Periodically refresh the ephemeral blockhash cache
    const refreshEphemeralBlockhash = useCallback(async () => {
        const eConn = ephemeralConnection.current;
        if (!eConn) return;
        try {
            const { blockhash, lastValidBlockHeight } = await eConn.getLatestBlockhash();
            cachedEphemeralBlockhashRef.current = {
                blockhash,
                lastValidBlockHeight,
                timestamp: Date.now(),
            };
        } catch (_) {
            // ignore refresh errors; keep previous cache
        }
    }, []);

    // Getter for cached ephemeral blockhash (refreshes if stale)
    const getCachedEphemeralBlockhash = useCallback(async (): Promise<string> => {
        const now = Date.now();
        const cached = cachedEphemeralBlockhashRef.current;
        if (!cached || now - cached.timestamp >= BLOCKHASH_CACHE_MAX_AGE_MS) {
            await refreshEphemeralBlockhash();
        }
        const latest = cachedEphemeralBlockhashRef.current;
        if (!latest) throw new Error('Ephemeral connection not available');
        return latest.blockhash;
    }, [refreshEphemeralBlockhash]);

    // Start the periodic refresher
    useEffect(() => {
        // Kick an initial refresh shortly after mount
        refreshEphemeralBlockhash();
        const id = setInterval(() => {
            refreshEphemeralBlockhash();
        }, BLOCKHASH_CACHE_MAX_AGE_MS);
        return () => clearInterval(id);
    }, [refreshEphemeralBlockhash]);

    // Initialize ephemeral connection
    useEffect(() => {
        if (ephemeralConnection.current) return;
        const endpoint = process.env.REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app";

        const conn = new Connection(endpoint);
        ephemeralConnection.current = conn;

        // Get the validator identity
        (conn as any)
            ._rpcRequest("getIdentity", [])
            .then((res: any) => {
                const identity = res?.result?.identity;
                validator.current = identity ? new PublicKey(identity) : undefined;
                console.log("Validator: ", validator.current?.toBase58());
            })
            .catch((e: any) => {
                console.error("getIdentity failed", e);
            });
    }, []);

    // Fetch mint decimals (L1 first, fallback to 6)
    useEffect(() => {
        if (!mint) return;
        let cancelled = false;
        (async () => {
            try {
                const mintInfo = await getMint(connection, mint, 'processed');
                if (!cancelled) setDecimals(mintInfo.decimals);
            } catch (_) {
                // ignore, keep default 6
            }
        })();
        return () => { cancelled = true };
    }, [connection, mint]);

    const ensureAirdropLamports = useCallback(async (conn: Connection, pubkey: PublicKey) => {
        try {
            const signature = await conn.requestAirdrop(pubkey, 0.1 * LAMPORTS_PER_SOL);
            const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
            await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
        } catch {
            // ignore airdrop errors
        }
    }, []);

    const ensureAta = useCallback(async (conn: Connection, owner: PublicKey): Promise<PublicKey> => {
        if (!mint) throw new Error('Mint not initialized. Run Setup first.');
        const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID);
        const info = await conn.getAccountInfo(ata);
        if (!info) {
            const tx = new Transaction().add(
                createAssociatedTokenAccountInstruction(owner, ata, owner, mint)
            );
            tx.feePayer = owner;
            const { blockhash } = await conn.getLatestBlockhash();
            tx.recentBlockhash = blockhash;
            // We assume owner is a temp Keypair we control
            const kp = accounts.find(a => a.keypair.publicKey.equals(owner))?.keypair;
            if (!kp) throw new Error('Missing keypair for owner');
            tx.sign(kp);
            await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
        }
        return ata;
    }, [accounts, mint]);

    const refreshBalances = useCallback(async () => {
        const eConn = ephemeralConnection.current;
        if (!eConn || !mint) return;

        const updated = await Promise.all(accountsRef.current.map(async (acc) => {
            const ata = getAssociatedTokenAddressSync(mint, acc.keypair.publicKey, false, TOKEN_PROGRAM_ID);
            const [eAta] = deriveEphemeralAta(acc.keypair.publicKey, mint);

            let balance = 0n;
            let eDelegated: boolean | undefined;

            // Fetch L1 balance and delegation status
            try {
                const ai = await connection.getAccountInfo(ata);
                if (ai) {
                    const b = await connection.getTokenAccountBalance(ata, 'processed');
                    balance = BigInt(b.value.amount);
                    const eAtaAcc = await connection.getAccountInfo(eAta);
                    eDelegated = eAtaAcc?.owner.equals(DELEGATION_PROGRAM_ID);
                }
            } catch {
                // defaults are fine
            }

            // Fetch ephemeral balance
            let eBalance = 0n;
            try {
                const aiE = await eConn.getAccountInfo(ata);
                if (aiE) {
                    const bE = await eConn.getTokenAccountBalance(ata, 'confirmed');
                    eBalance = BigInt(bE.value.amount);
                }
            } catch {
                // default is fine
            }

            // Fetch SOL balance
            let solLamports = 0n;
            try {
                solLamports = BigInt(await connection.getBalance(acc.keypair.publicKey, 'confirmed'));
            } catch {
                // default is fine
            }

            return { ...acc, ata, eAta, balance, eBalance, solLamports, eDelegated } as TempAccount;
        }));

        setAccounts(updated);
    }, [connection, mint]);

    // Refresh on mount and whenever the key set or connections change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { refreshBalances().catch(console.error); }, [connection, mint]);

    // Persist secret keys if the set of accounts changes (ignore balance-only updates)
    const accountKeysFingerprint = useMemo(
        () => accounts.map((a) => a.keypair.publicKey.toBase58()).join('|'),
        [accounts]
    );

    // Fingerprint of eATA addresses to drive subscription lifecycle
    const ataFingerprint = useMemo(
        () => accounts.map((a) => a.ata?.toBase58() ?? '').join('|'),
        [accounts]
    );
    useEffect(() => {
        safeLocalStorage.set(LS_KEY, {
            version: 1,
            keys: accounts.map(a => toBase64(a.keypair.secretKey))
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountKeysFingerprint]);

    // Subscribe to ata changes on the ephemeral connection for each account
    useEffect(() => {
        const eConn = ephemeralConnection.current;
        if (!eConn || !mint) return;

        const ids: number[] = [];

        const parseTokenAmount = (accountInfo: { data: Buffer | Uint8Array }) => {
            const data = Buffer.isBuffer(accountInfo.data)
                ? accountInfo.data
                : Buffer.from(accountInfo.data);

            // SPL token account layout: mint(32) + owner(32) + amount(u64 at offset 64)
            if (data.length < 72) return null;
            return data.readBigUInt64LE(64);
        };

        for (const a of accounts) {
            if (!a.ata) continue;

            try {
                const id = eConn.onAccountChange(
                    a.ata,
                    async (accountInfo) => {
                        try {
                            const amount = parseTokenAmount(accountInfo);
                            if (amount === null) return;

                            setAccounts((prev) =>
                                prev.map((p) =>
                                    p.keypair.publicKey.equals(a.keypair.publicKey)
                                        ? { ...p, eBalance: amount, eDelegated: p.eDelegated }
                                        : p
                                )
                            );
                        } catch (err) {
                            console.error('Error parsing token amount:', err);
                        }
                    },
                    "processed"
                );

                ids.push(id);
            } catch (_) {
                /* ignore */
            }
        }

        return () => {
            ids.forEach((id) => {
                try {
                    eConn.removeAccountChangeListener(id);
                } catch (_) {
                    /* ignore */
                }
            });
        };
        // Re-subscribe when ata set changes or mint changes
    }, [accounts, ataFingerprint, mint]);

    // Also refresh balances when the set of account keys changes (not on balance-only updates)
    useEffect(() => {
        refreshBalances().catch(console.error);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountKeysFingerprint]);

    const copyPk = useCallback(async (pk: PublicKey) => {
        try {
            await navigator.clipboard.writeText(pk.toBase58());
        } catch {
            // Fallback for non-secure contexts
            try {
                const ta = document.createElement('textarea');
                ta.value = pk.toBase58();
                Object.assign(ta.style, { position: 'fixed', left: '-9999px' });
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            } catch {
                // ignore copy errors
            }
        }
    }, []);

    // Unified transfer logic used by both normal and quick transfers
    const performTransfer = useCallback(async (fromIdx: number, toIdx: number, amountUi: string) => {
        setTransactionError(null);
        setTransactionSuccess(null);
        const eConn = ephemeralConnection.current;
        if (!mint) {
            setTransactionError('Mint not initialized. Run Setup first.');
            return;
        }
        if ((useEphemeral || usePrivateTransfer) && !eConn) return;
        const src = accounts[fromIdx];
        const dst = accounts[toIdx];
        if (!src || !dst) return setTransactionError('Invalid source/destination');
        if (fromIdx === toIdx) return setTransactionError('Source and destination must be different');
        const conn = usePrivateTransfer ? connection : (useEphemeral ? eConn : connection);
        if (!conn) return;
        try {
            setIsSubmitting(true);
            const srcAta = getAssociatedTokenAddressSync(mint, src.keypair.publicKey, false, TOKEN_PROGRAM_ID);
            const dstAta = getAssociatedTokenAddressSync(mint, dst.keypair.publicKey, false, TOKEN_PROGRAM_ID);
            const amountBn = parseAmount(amountUi, decimals);
            if (amountBn <= 0n) throw new Error('Invalid amount');

            const ixs: TransactionInstruction[] = [];

            if (usePrivateTransfer) {
                const delaySecondsNumber = Number(privateDelaySeconds);
                const splitCountNumber = Number(privateSplitCount);
                if (!Number.isInteger(delaySecondsNumber) || delaySecondsNumber < 0) {
                    throw new Error('Private delay must be a non-negative integer');
                }
                if (!Number.isInteger(splitCountNumber) || splitCountNumber <= 0) {
                    throw new Error('Private split must be a positive integer');
                }
                if (BigInt(splitCountNumber) > amountBn) {
                    throw new Error('Private split cannot exceed the transfer amount in base units');
                }

                const [transferQueue] = deriveTransferQueue(mint);
                const [vault] = deriveVault(mint);
                const vaultAta = deriveVaultAta(mint, vault);
                ixs.push(
                    createDepositAndQueueTransferInstruction(
                        transferQueue,
                        vault,
                        mint,
                        srcAta,
                        vaultAta,
                        dstAta,
                        src.keypair.publicKey,
                        amountBn,
                        BigInt(delaySecondsNumber),
                        splitCountNumber,
                    ),
                );
            } else {
                if (!accounts[fromIdx].eDelegated) {
                    await ensureAta(conn, src.keypair.publicKey);
                }

                // If using ephemeral and destination hasn't been delegated/initialized, do it first
                if (!accounts[toIdx].eDelegated) {
                    const dstInfo = await conn.getAccountInfo(dstAta);
                    if (!dstInfo) {
                        ixs.push(createAssociatedTokenAccountInstruction(src.keypair.publicKey, dstAta, dst.keypair.publicKey, mint));
                    }
                    if (useEphemeral) {
                        const delIxs = await delegateSpl(
                            dst.keypair.publicKey,
                            mint,
                            0n,
                            {
                                validator: validator.current,
                                initIfMissing: true,
                            }
                        );
                        const delTx = new Transaction().add(...delIxs);
                        delTx.feePayer = dst.keypair.publicKey;
                        const {blockhash: delBh} = await connection.getLatestBlockhash();
                        delTx.recentBlockhash = delBh;
                        delTx.sign(dst.keypair);
                        const delSig = await connection.sendRawTransaction(delTx.serialize());
                        await connection.confirmTransaction(delSig, 'confirmed');
                        const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
                        await delay(2000);
                        await refreshBalances();
                    }
                }

                const ixTransfer = createTransferInstruction(
                    srcAta,
                    dstAta,
                    src.keypair.publicKey,
                    amountBn,
                    [],
                    TOKEN_PROGRAM_ID
                );
                // Add noop instruction to make the transaction unique
                ixs.push(createNoopInstruction());
                ixs.push(ixTransfer);
            }

            let sig;
            if (usePrivateTransfer || useEphemeral) {
                if (!ephemeralConnection.current) return;
                const eTx = new anchor.web3.Transaction().add(...ixs);
                eTx.feePayer = src.keypair.publicKey;
                const blockhash = await getCachedEphemeralBlockhash();
                eTx.recentBlockhash = blockhash;
                eTx.sign(src.keypair);
                sig = await ephemeralConnection.current.sendRawTransaction(eTx.serialize(), { skipPreflight: true });
                await ephemeralConnection.current.confirmTransaction(sig, 'confirmed');
            } else {
                const tx = new Transaction().add(...ixs);
                tx.feePayer = src.keypair.publicKey;
                const { blockhash } = await conn.getLatestBlockhash();
                tx.recentBlockhash = blockhash;
                tx.sign(src.keypair);
                sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
                await conn.confirmTransaction(sig, 'confirmed');
            }
            setTransactionSuccess(`${usePrivateTransfer ? 'Private transfer queued' : 'Transfer confirmed'}: ${sig.substring(0, 10)}...${sig.substring(sig.length - 10, sig.length)}`);
            console.log("Private transfer: ", sig);
            await refreshBalances();
        } catch (e: any) {
            setTransactionError(await formatTransactionError(e, conn));
        } finally {
            setIsSubmitting(false);
        }
    }, [accounts, connection, decimals, ensureAta, getCachedEphemeralBlockhash, mint, privateDelaySeconds, privateSplitCount, refreshBalances, useEphemeral, usePrivateTransfer]);

    const handleTransfer = useCallback(async () => {
        await performTransfer(srcIndex, dstIndex, amountStr);
    }, [performTransfer, srcIndex, dstIndex, amountStr]);

    const setupAll = useCallback(async () => {
        const eConn = ephemeralConnection.current;
        if (!eConn) return;
        setTransactionError(null);
        setTransactionSuccess(null);
        const payer = accounts[0].keypair;
        try {
            // Airdrop a small amount of SOL to each local wallet to cover fees
            for (const a of accounts) {
                await ensureAirdropLamports(connection, a.keypair.publicKey);
            }

            // 1) Create a random mint and store it in localStorage
            const mintKp = Keypair.generate();
            const mintDecimals = 6; // default; can be parameterized
            const amountBase = BigInt(500) * BigInt(10) ** BigInt(mintDecimals); // 500 tokens each

            // Helper to create mint + ATAs + mintTo on a given connection
            const setupOn = async (conn: Connection) => {
                const ataPubkeys = accounts.map(a => getAssociatedTokenAddressSync(mintKp.publicKey, a.keypair.publicKey));
                const [transferQueue] = deriveTransferQueue(mintKp.publicKey);

                const mintTx = new Transaction().add(
                    SystemProgram.createAccount({
                        fromPubkey: payer.publicKey,
                        newAccountPubkey: mintKp.publicKey,
                        space: MINT_SIZE,
                        lamports: await getMinimumBalanceForRentExemptMint(conn),
                        programId: TOKEN_PROGRAM_ID,
                    }),
                    createInitializeMintInstruction(
                        mintKp.publicKey,
                        mintDecimals,
                        payer.publicKey,
                        null
                    ),
                    // create ATAs for all accounts
                    ...accounts.map((a, idx) =>
                        createAssociatedTokenAccountInstruction(
                            payer.publicKey,
                            ataPubkeys[idx],
                            a.keypair.publicKey,
                            mintKp.publicKey
                        )
                    ),
                    // mint tokens to each
                    ...ataPubkeys.map(ata =>
                        createMintToInstruction(
                            mintKp.publicKey,
                            ata,
                            payer.publicKey,
                            Number(amountBase)
                        )
                    ),
                    initTransferQueueIx(
                        payer.publicKey,
                        transferQueue,
                        mintKp.publicKey,
                    ),
                    delegateTransferQueueIx(
                        transferQueue,
                        payer.publicKey,
                        mintKp.publicKey,
                    ),
                );
                mintTx.feePayer = payer.publicKey;
                const mintSig = await sendAndConfirmTransaction(
                    conn,
                    mintTx,
                    [payer, mintKp],
                    {
                        commitment: 'confirmed',
                        preflightCommitment: 'confirmed',
                        skipPreflight: true,
                    },
                );
                console.log("Mint and queue setup tx: ", mintSig)

                const startCrankQueueTx = new Transaction().add(

                    ensureTransferQueueCrankIx(
                        payer.publicKey,
                        // payer.publicKey,
                        transferQueue,
                    ),
                );
                startCrankQueueTx.feePayer = payer.publicKey;
                const crankQueueSig = await sendAndConfirmTransaction(
                    eConn,
                    startCrankQueueTx,
                    [payer],
                    {
                        commitment: 'confirmed',
                        preflightCommitment: 'confirmed',
                        skipPreflight: true,
                    },
                );
                console.log("Crank queue setup tx: ", crankQueueSig)
            };

            await setupOn(connection);

            // Persist mint
            safeLocalStorage.set(LS_MINT_KEY, {
                version: 1,
                secret: toBase64(mintKp.secretKey),
                pubkey: mintKp.publicKey.toBase58(),
                decimals: mintDecimals,
            });

            // Update state and refresh
            setMint(mintKp.publicKey);
            setDecimals(mintDecimals);
            setTransactionSuccess('Mint created, ATAs initialized, tokens minted, queue initialized, and crank started');

            await refreshBalances();
        } catch (e: any) {
            setTransactionError(await formatTransactionError(e, connection));
        }
    }, [accounts, connection, ensureAirdropLamports, refreshBalances]);

    // Auto-run setup once on start if no mint is set
    useEffect(() => {
        if (mint) return; // already set or loaded from storage
        if (autoSetupTriggeredRef.current) return; // guard against multiple triggers (e.g., StrictMode)
        autoSetupTriggeredRef.current = true;
        // Fire and forget; internal errors are surfaced via state
        setupAll().catch(console.error);
    }, [mint, setupAll]);

    const resetMint = useCallback(async () => {
        safeLocalStorage.remove(LS_MINT_KEY);
        setMint(null);
        setDecimals(6);
        setTransactionSuccess('Mint reset. Run Setup to create a new mint.');
        await refreshBalances();
    }, [refreshBalances]);

    return (
        <>
            <style>{`
              @media (max-width: 640px) {
                .counter-ui {
                  padding-left: 16px;
                  padding-right: 16px;
                }
              }
            `}</style>
            <div className="counter-ui" style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 64 }}>
            <h1 style={{ textAlign: 'center', marginBottom: 16, marginTop: 16 }}> </h1>

            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
                {accounts.map((a, i) => (
                    <div key={i}
                         onDragOver={(e) => {
                             // Allow dropping quick-transfer buttons
                             e.preventDefault();
                         }}
                         onDrop={(e) => {
                             try {
                                 const raw = e.dataTransfer.getData('text/plain');
                                 if (!raw) return;
                                 const payload = JSON.parse(raw);
                                 if (payload?.type === 'quickTransfer') {
                                     const fromIdx = Number(payload.from);
                                     const amountUi = String(payload.amountUi);
                                     if (!Number.isNaN(fromIdx) && amountUi) {
                                         performTransfer(fromIdx, i, amountUi).catch(console.error);
                                     }
                                 }
                             } catch (_) { /* ignore */ }
                         }}
                         style={{ ...CARD_STYLE, minWidth: 250 }}>
                        <div style={{ height: 4, borderRadius: 999, background: 'linear-gradient(90deg,#22d3ee,#a78bfa)', marginBottom: 12, opacity: 0.9 }} />
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>Address</div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <div style={{ fontFamily: 'monospace', color: '#ffffff', letterSpacing: '0.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {short(a.keypair.publicKey)}
                            </div>
                            <button
                                onClick={() => copyPk(a.keypair.publicKey)}
                                title="Copy public key"
                                aria-label={`Copy public key for wallet #${i + 1}`}
                                style={{
                                    width: 24,
                                    height: 24,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: 0,
                                    margin: 0,
                                    lineHeight: 0,
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#e5e7eb',
                                    borderRadius: 6,
                                    cursor: 'pointer',
                                }}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                >
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                            </button>
                        </div>
                        <div style={{ height: 8 }} />
                        {/* SOL balance, centered and shown before SPL balances */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ fontSize: 12, color: '#9ca3af' }}>SOL</div>
                            <div style={{ fontWeight: 700, color: '#fbbf24', fontSize: 16 }}>{fmt(a.solLamports, 9)}</div>
                        </div>
                        <div style={{ height: 8 }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <div>
                                <div style={{ fontSize: 12, color: '#9ca3af' }}>SPL</div>
                                <div style={{ fontWeight: 700, color: '#22d3ee', fontSize: 16 }}>{fmt(a.balance, decimals)}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 12, color: '#9ca3af' }}>Ephemeral SPL</div>
                                <div style={{ fontWeight: 700, color: '#a78bfa', fontSize: 16 }}>{a.eDelegated ? fmt(a.eBalance, decimals) : '-'}</div>
                            </div>
                        </div>
                        <div style={{ height: 2 }} />
                        {/* Quick transfer draggable chips (1, 3, 10) */}
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
                            {[1, 3, 10].map((amt) => (
                                <button
                                    key={`qt-${i}-${amt}`}
                                    draggable
                                    onDragStart={(e) => {
                                        const payload = JSON.stringify({ type: 'quickTransfer', from: i, amountUi: String(amt) });
                                        e.dataTransfer.setData('text/plain', payload);
                                        // Optional drag image tweak for better UX
                                        const el = document.createElement('div');
                                        el.style.padding = '2px 8px';
                                        el.style.background = 'rgba(167,139,250,0.2)';
                                        el.style.color = '#e5e7eb';
                                        el.style.border = '1px solid rgba(167,139,250,0.35)';
                                        el.style.borderRadius = '999px';
                                        el.style.fontSize = '12px';
                                        el.style.position = 'absolute';
                                        el.style.top = '-9999px';
                                        el.textContent = `${amt}`;
                                        document.body.appendChild(el);
                                        e.dataTransfer.setDragImage(el, 0, 0);
                                        setTimeout(() => document.body.removeChild(el), 0);
                                    }}
                                    title={`Drag to another wallet to transfer ${amt}`}
                                    aria-label={`Drag to another wallet to transfer ${amt}`}
                                    style={{
                                        background: 'rgba(255,255,255,0.06)',
                                        border: '1px solid rgba(167,139,250,0.35)',
                                        color: '#e5e7eb',
                                        borderRadius: 999,
                                        padding: '2px 8px',
                                        fontSize: 12,
                                        lineHeight: 1,
                                        cursor: 'grab',
                                        userSelect: 'none'
                                    }}
                                    onClick={() => {
                                        // Click fallback: set up transfer form and execute using existing handler
                                        setSrcIndex(i);
                                        setAmountStr(String(amt));
                                    }}
                                >
                                    {amt}
                                </button>
                            ))}
                        </div>
                        <div style={{ height: 2 }} />
                        {/* Delegation status on Ephemeral chain */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: a.eDelegated ? '#34d399' : '#f87171' }}>
                                {a.eDelegated ? 'eATA Delegated' : 'eAta not delegated'}
                            </div>
                        </div>
                        <div style={{ height: 8 }} />
                        {/* Delegate */}
                        <div style={{ display: 'grid', width: '100%', gridTemplateColumns: '7fr 3fr', gap: 8, alignItems: 'center' }}>
                            <input
                                type="number"
                                min={0}
                                step={1/10**Math.min(decimals, 6)}
                                value={delegateAmounts[i] ?? ''}
                                onChange={(e) => {
                                    const next = delegateAmounts.slice();
                                    next[i] = cleanNumericInput(e.target.value, decimals);
                                    setDelegateAmounts(next);
                                }}
                                placeholder=""
                                inputMode="decimal"
                                style={{ ...INPUT_STYLE, width: '100%', margin: 0, boxSizing: 'border-box', height: 40 }}
                            />
                            <button
                                onClick={async () => {
                                    // Placeholder action — wiring not requested; just log
                                    // Amount is in UI units (respecting decimals)
                                    if(!ephemeralConnection.current) return;
                                    setTransactionError(null);
                                    setTransactionSuccess(null);
                                    const eConn = ephemeralConnection.current;
                                    if (!eConn) return;
                                    if (!connection) return;
                                    if (!mint) {
                                        setTransactionError('Mint not initialized. Airdrops funds manually if rate-limited');
                                        return;
                                    }
                                    try {
                                        setIsSubmitting(true);
                                        const raw = (delegateAmounts[i] ?? '').trim();
                                        if (!raw) throw new Error('Enter amount to delegate');
                                        const amountBn = parseAmount(raw, decimals);
                                        if (amountBn <= 0n) throw new Error('Invalid amount');

                                        // if (a.eDelegated) {
                                        //     // 1) Send undelegate instruction on Ephemeral rollup
                                        //     const ixU = undelegateIx(a.keypair.publicKey, mint);
                                        //     const txU = new Transaction().add(createNoopInstruction(), ixU);
                                        //     txU.feePayer = a.keypair.publicKey;
                                        //     const bhU = await getCachedEphemeralBlockhash();
                                        //     txU.recentBlockhash = bhU;
                                        //     txU.sign(a.keypair);
                                        //     const sigU = await eConn.sendRawTransaction(txU.serialize(), {skipPreflight: true});
                                        //     await eConn.confirmTransaction(sigU, 'confirmed');
                                        //
                                        //     // Wait for commitment signature, then confirm on L1
                                        //     const txCommitSgn = await GetCommitmentSignature(sigU, eConn);
                                        //     await connection.confirmTransaction(txCommitSgn, 'confirmed');
                                        // }

                                        // Build instructions via SDK
                                        const shuttleId = crypto.getRandomValues(new Uint32Array(1))[0];
                                        const ixs = await delegateSpl(
                                            a.keypair.publicKey,
                                            mint,
                                            amountBn,
                                            {
                                                validator: validator.current,
                                                initIfMissing: true,
                                                initVaultIfMissing: true,
                                                idempotent: true,
                                                shuttleId,
                                            }
                                        );
                                        const tx = new Transaction();
                                        ixs.forEach((ix) => tx.add(ix));
                                        tx.feePayer = a.keypair.publicKey;
                                        const { blockhash } = await connection.getLatestBlockhash();
                                        tx.recentBlockhash = blockhash;
                                        tx.sign(a.keypair);

                                        const sig = await connection.sendRawTransaction(tx.serialize());
                                        await connection.confirmTransaction(sig, 'confirmed');
                                        setTransactionSuccess('Delegation confirmed');
                                        console.log("Delegation: ", sig);

                                        // TODO: Send tx to the ephemeral to merge_shuttle_ephemeral_ata
                                        const [shuttleEphemeralAta] = deriveShuttleEphemeralAta(
                                            a.keypair.publicKey,
                                            mint,
                                            shuttleId,
                                        );
                                        const shuttleWalletAta = deriveShuttleWalletAta(
                                            mint,
                                            shuttleEphemeralAta,
                                        );
                                        const [shuttleAta] = deriveShuttleAta(shuttleEphemeralAta, mint);
                                        const ownerAta = getAssociatedTokenAddressSync(
                                            mint,
                                            a.keypair.publicKey,
                                            false,
                                            TOKEN_PROGRAM_ID,
                                        );
                                        const mergeIx = mergeShuttleIntoAtaIx(
                                            a.keypair.publicKey,
                                            ownerAta,
                                            shuttleEphemeralAta,
                                            shuttleWalletAta,
                                            mint,
                                        );
                                        const txMerge = new Transaction().add(createNoopInstruction(), mergeIx);
                                        txMerge.feePayer = a.keypair.publicKey;
                                        const bhMerge = await getCachedEphemeralBlockhash();
                                        txMerge.recentBlockhash = bhMerge;
                                        txMerge.sign(a.keypair);

                                        const sigMerge = await eConn.sendRawTransaction(txMerge.serialize(), {
                                            skipPreflight: false,
                                        });
                                        console.log("Merging: " + sigMerge);
                                        console.log("Shuttle ephemeral Ata: ", shuttleEphemeralAta.toBase58());
                                        console.log("Owner Ata: ", ownerAta.toBase58());

                                        // TODO: call undelegate_and_close_shuttle_ephemeral_ata in the ER
                                        try {
                                            await eConn.confirmTransaction(sigMerge, 'confirmed');
                                        } catch (confirmErr) {
                                            console.warn(
                                                "Merge confirmation failed on first attempt, retrying once...",
                                                confirmErr,
                                            );
                                            await new Promise((resolve) => setTimeout(resolve, 400));
                                            await eConn.confirmTransaction(sigMerge, 'confirmed');
                                        }
                                        const closeShuttleIx = undelegateAndCloseShuttleEphemeralAtaIx(
                                            a.keypair.publicKey,
                                            shuttleEphemeralAta,
                                            shuttleAta,
                                            shuttleWalletAta,
                                        );
                                        const txCloseShuttle = new Transaction().add(
                                            createNoopInstruction(),
                                            closeShuttleIx,
                                        );
                                        txCloseShuttle.feePayer = a.keypair.publicKey;
                                        txCloseShuttle.recentBlockhash = await getCachedEphemeralBlockhash();
                                        txCloseShuttle.sign(a.keypair);
                                        const sigCloseShuttle = await eConn.sendRawTransaction(
                                            txCloseShuttle.serialize(),
                                            { skipPreflight: true },
                                        );
                                        console.log("Closing: ", sigCloseShuttle);
                                        await eConn.confirmTransaction(sigCloseShuttle, 'confirmed');

                                        await refreshBalances();
                                    } catch (e: any) {
                                        setTransactionError(await formatTransactionError(e, connection));
                                    } finally {
                                        setIsSubmitting(false);
                                    }
                                }}
                                style={{
                                    width: '100%',
                                    minWidth: 110,
                                    background: 'linear-gradient(90deg,#22d3ee,#06b6d4)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    color: '#0b1220',
                                    fontWeight: 700,
                                    borderRadius: 6,
                                    cursor: 'pointer',
                                    height: 40,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxSizing: 'border-box',
                                    padding: '0 12px',
                                    margin: 0,
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Delegate
                            </button>
                        </div>
                        <div style={{ height: 8 }} />
                        {/* Undelegate */}
                        <div style={{ display: 'grid', width: '100%', gridTemplateColumns: '7fr 3fr', gap: 8, alignItems: 'center' }}>
                            <input
                                type="number"
                                min={0}
                                step={1/10**Math.min(decimals, 6)}
                                value={undelegateAmounts[i] ?? ''}
                                onChange={(e) => {
                                    const next = undelegateAmounts.slice();
                                    next[i] = cleanNumericInput(e.target.value, decimals);
                                    setUndelegateAmounts(next);
                                }}
                                placeholder=""
                                inputMode="decimal"
                                style={{ ...INPUT_STYLE, width: '100%', margin: 0, boxSizing: 'border-box', height: 40 }}
                            />
                            <button
                                onClick={async () => {
                                    // Undelegate on Ephemeral first (if delegated), then withdraw on L1, for this specific account
                                    setTransactionError(null);
                                    setTransactionSuccess(null);
                                    const eConn = ephemeralConnection.current;
                                    if (!eConn) return;
                                    if (!mint) {
                                        setTransactionError('Mint not initialized. Run Setup first.');
                                        return;
                                    }
                                    try {
                                        setIsSubmitting(true);
                                        const raw = (undelegateAmounts[i] ?? '').trim();
                                        if (!raw) throw new Error('Enter amount to undelegate & withdraw');
                                        const amountBn = parseAmount(raw, decimals);
                                        if (amountBn <= 0n) throw new Error('Invalid amount');

                                        if (a.eDelegated) {
                                            // 1) Send undelegate instruction on Ephemeral rollup
                                            const ixU = undelegateIx(a.keypair.publicKey, mint);
                                            const txU = new Transaction().add(createNoopInstruction(), ixU);
                                            txU.feePayer = a.keypair.publicKey;
                                            const bhU = await getCachedEphemeralBlockhash();
                                            txU.recentBlockhash = bhU;
                                            txU.sign(a.keypair);
                                            const sigU = await eConn.sendRawTransaction(txU.serialize(), {skipPreflight: true});
                                            await eConn.confirmTransaction(sigU, 'confirmed');

                                            // Wait for commitment signature, then confirm on L1
                                            const txCommitSgn = await GetCommitmentSignature(sigU, eConn);
                                            await connection.confirmTransaction(txCommitSgn, 'confirmed');
                                        }

                                        // 2) Withdraw on L1 for the requested amount
                                        const ixW = withdrawSplIx(a.keypair.publicKey, mint, amountBn);
                                        const txW = new Transaction().add(ixW);
                                        txW.feePayer = a.keypair.publicKey;
                                        const { blockhash: bhW } = await connection.getLatestBlockhash({commitment: "finalized"});
                                        txW.recentBlockhash = bhW;
                                        txW.sign(a.keypair);
                                        const sigW = await connection.sendRawTransaction(txW.serialize(), { skipPreflight: true });
                                        await connection.confirmTransaction(sigW, 'confirmed');

                                        setTransactionSuccess('Undelegation and withdraw confirmed');
                                        await refreshBalances();
                                    } catch (e: any) {
                                        setTransactionError(await formatTransactionError(e, connection));
                                    } finally {
                                        setIsSubmitting(false);
                                    }
                                }}
                                style={{
                                    width: '100%',
                                    minWidth: 110,
                                    background: 'linear-gradient(90deg,#a78bfa,#7c3aed)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    color: '#0b1220',
                                    fontWeight: 700,
                                    borderRadius: 6,
                                    cursor: 'pointer',
                                    height: 40,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxSizing: 'border-box',
                                    padding: '0 12px',
                                    margin: 0,
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Undelegate
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {mint && (
                <>
                    <div style={{ height: 16 }} />
                    <div style={CARD_STYLE}>
                        <div style={{ height: 4, borderRadius: 999, background: 'linear-gradient(90deg,#22d3ee,#a78bfa)', marginBottom: 12, opacity: 0.9 }} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12 }}>
                                    From
                                    <select
                                        value={srcIndex}
                                        onChange={e => setSrcIndex(Number(e.target.value))}
                                        style={{ ...INPUT_STYLE, padding: '6px 8px' }}
                                    >
                                        {accounts.map((_, i) => <option key={`s-${i}`} value={i}>#{i+1}</option>)}
                                    </select>
                                </label>

                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12 }}>
                                    To
                                    <select
                                        value={dstIndex}
                                        onChange={e => setDstIndex(Number(e.target.value))}
                                        style={{ ...INPUT_STYLE, padding: '6px 8px' }}
                                    >
                                        {accounts.map((_, i) => <option key={`d-${i}`} value={i}>#{i+1}</option>)}
                                    </select>
                                </label>

                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12 }}>
                                    Amount
                                    <input
                                        type="number"
                                        min="0"
                                        step={1/10**Math.min(decimals, 6)}
                                        value={amountStr}
                                        onChange={e => setAmountStr(e.target.value)}
                                        style={{ ...INPUT_STYLE, width: '70%', padding: '6px 8px' }}
                                    />
                                </label>

                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9ca3af', fontSize: 12 }}>
                                    <input
                                        type="checkbox"
                                        checked={usePrivateTransfer}
                                        onChange={e => {
                                            const checked = e.target.checked;
                                            setUsePrivateTransfer(checked);
                                            if (checked) {
                                                setUseEphemeral(true);
                                            }
                                        }}
                                    />
                                    Private
                                </label>

                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9ca3af', fontSize: 12, opacity: usePrivateTransfer ? 0.5 : 1 }}>
                                    <input
                                        type="checkbox"
                                        checked={useEphemeral}
                                        disabled={usePrivateTransfer}
                                        onChange={e => {
                                            const checked = e.target.checked;
                                            setUseEphemeral(checked);
                                            if (!checked) {
                                                setUsePrivateTransfer(false);
                                            }
                                        }}
                                    />
                                    Ephemeral
                                </label>

                                <button
                                    onClick={handleTransfer}
                                    disabled={isSubmitting || !mint}
                                    style={{ ...BUTTON_STYLE, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}
                                >
                                    {isSubmitting ? (usePrivateTransfer ? 'Queueing…' : 'Transferring…') : (usePrivateTransfer ? 'Queue Transfer' : 'Transfer')}
                                </button>
                            </div>

                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12, opacity: usePrivateTransfer ? 1 : 0.5 }}>
                                    Delay (s)
                                    <input
                                        type="number"
                                        min="0"
                                        step={1}
                                        value={privateDelaySeconds}
                                        disabled={!usePrivateTransfer}
                                        onChange={e => setPrivateDelaySeconds(e.target.value)}
                                        style={{ ...INPUT_STYLE, width: 96, padding: '6px 8px' }}
                                    />
                                </label>

                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12, opacity: usePrivateTransfer ? 1 : 0.5 }}>
                                    Split
                                    <input
                                        type="number"
                                        min="1"
                                        step={1}
                                        value={privateSplitCount}
                                        disabled={!usePrivateTransfer}
                                        onChange={e => setPrivateSplitCount(e.target.value)}
                                        style={{ ...INPUT_STYLE, width: 80, padding: '6px 8px' }}
                                    />
                                </label>
                            </div>
                        </div>
                    </div>
                </>
            )}

            <div style={{ height: 24 }} />

            <div style={CARD_STYLE}>
                <div style={{ height: 4, borderRadius: 999, background: 'linear-gradient(90deg,#22d3ee,#a78bfa)', marginBottom: 12, opacity: 0.9 }} />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    {!mint ? (
                        <div style={{
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: '#fbbf24'
                        }}>
                            No test mint yet — click "Setup" to create one.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12 }}>
                            Mint
                            <span style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>{short(mint)}</span>
                            <button
                                onClick={() => copyPk(mint)}
                                title="Copy mint address"
                                style={{ ...BUTTON_STYLE, borderRadius: 6, padding: '4px 6px' }}
                            >Copy</button>
                            <button
                                onClick={() => resetMint()}
                                title="Reset mint"
                                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#fecaca', borderRadius: 6, padding: '4px 6px', cursor: 'pointer' }}
                            >Reset</button>
                        </div>
                    )}
                    {!mint && (
                        <button
                            onClick={() => setupAll()}
                            disabled={isSubmitting}
                            style={{ ...BUTTON_STYLE, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}
                        >
                            Setup
                        </button>
                    )}
                </div>
            </div>

            {isSubmitting && (<div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'flex-end',
                position: 'fixed',
                bottom: '20px',
                left: 0,
                width: '100%',
                zIndex: 1000,
            }}>
                <div className="spinner"></div>
            </div>)}

            {transactionError && <Alert type="error" message={transactionError} onClose={() => setTransactionError(null)} />}
            {transactionSuccess && <Alert type="success" message={transactionSuccess} onClose={() => setTransactionSuccess(null)} />}

            <img src={`${process.env.PUBLIC_URL}/magicblock_white.png`} alt="Magic Block Logo" className="magicblock-logo"/>
        </div>
        </>
    );
};

export default App;
