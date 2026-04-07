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
    deriveEphemeralAta,
    deriveLamportsPda,
    deriveRentPda,
    deriveShuttleEphemeralAta,
    deriveShuttleWalletAta,
    deriveTransferQueue,
    delegateTransferQueueIx,
    ensureTransferQueueCrankIx,
    initRentPdaIx,
    initTransferQueueIx,
    lamportsDelegatedTransferIx,
    magicFeeVaultPdaFromValidator,
    transferSpl,
    withdrawSpl,
    delegateSpl,
    deriveShuttleAta, initVaultIx, initVaultAtaIx, delegateEphemeralAtaIx, deriveVault, deriveVaultAta,
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

const SETUP_MINT_ENV = (process.env.SETUP_MINT || process.env.REACT_APP_SETUP_MINT || '').trim();
const CONFIGURED_SETUP_MINT = (() => {
    if (!SETUP_MINT_ENV) return null;
    try {
        return new PublicKey(SETUP_MINT_ENV);
    } catch (error) {
        console.error('Invalid SETUP_MINT value:', SETUP_MINT_ENV, error);
        return null;
    }
})();
const SETUP_QUEUE_KEYPAIR_ENV = (process.env.SETUP_QUEUE_KEYPAIR || process.env.REACT_APP_SETUP_QUEUE_KEYPAIR || '').trim();
const SETUP_QUEUE_KEYPAIR_JSON_ENV = (process.env.SETUP_QUEUE_KEYPAIR_JSON || '').trim();

const resolveSetupQueueKeypairPath = (value: string): string => {
    if (
        !value ||
        value.startsWith('/') ||
        value.startsWith('./') ||
        value.startsWith('../') ||
        /^[a-z][a-z0-9+.-]*:/i.test(value)
    ) {
        return value;
    }

    const publicUrl = (process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
    return publicUrl ? `${publicUrl}/${value}` : value;
};

const parseSetupQueueKeypair = (raw: unknown): Keypair => {
    const secretKey = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { secretKey?: unknown }).secretKey)
            ? (raw as { secretKey: unknown[] }).secretKey
            : null;

    if (
        !secretKey ||
        secretKey.length !== 64 ||
        secretKey.some((value) => typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255)
    ) {
        throw new Error('Expected keypair.json to contain 64 secret key bytes.');
    }

    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
};

const CONFIGURED_SETUP_QUEUE_KEYPAIR = (() => {
    if (!SETUP_QUEUE_KEYPAIR_JSON_ENV) return null;
    try {
        return parseSetupQueueKeypair(JSON.parse(SETUP_QUEUE_KEYPAIR_JSON_ENV));
    } catch (error) {
        console.error('Invalid SETUP_QUEUE_KEYPAIR file contents:', error);
        return null;
    }
})();

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

const parseTokenAmount = (accountInfo: { data: Buffer | Uint8Array }): bigint | null => {
    const data = Buffer.isBuffer(accountInfo.data)
        ? accountInfo.data
        : Buffer.from(accountInfo.data);

    // SPL token account layout: mint(32) + owner(32) + amount(u64 at offset 64)
    if (data.length < 72) return null;
    return data.readBigUInt64LE(64);
};

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

const COMPACT_BUTTON_STYLE = {
    ...BUTTON_STYLE,
    margin: 0,
    width: 'auto',
    whiteSpace: 'nowrap',
} as const;

const App: React.FC = () => {
    const { connection } = useConnection();
    const ephemeralConnection = useRef<Connection | null>(null);
    const validator = useRef<PublicKey | undefined>(undefined);
    const accountsRef = useRef<TempAccount[]>([]);
    const setupQueueKeypairRef = useRef<Keypair | null>(CONFIGURED_SETUP_QUEUE_KEYPAIR);
    const setupQueueKeypairPromiseRef = useRef<Promise<Keypair | null> | null>(null);
    // Ensure auto-setup runs only once on first load when no mint is present
    const autoSetupTriggeredRef = useRef(false);
    const autoSetupRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    type CachedBlockhash = {
        blockhash: string
        lastValidBlockHeight: number
        timestamp: number
    }

    // Config
    const [mint, setMint] = useState<PublicKey | null>(() => {
        if (CONFIGURED_SETUP_MINT) return CONFIGURED_SETUP_MINT;
        const stored = safeLocalStorage.get<StoredMint | null>(LS_MINT_KEY, null);
        return stored?.version === 1 && stored.pubkey ? new PublicKey(stored.pubkey) : null;
    });
    const [decimals, setDecimals] = useState<number>(() => {
        if (CONFIGURED_SETUP_MINT) return 6;
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
    const [setupQueueKeypairPublicKey, setSetupQueueKeypairPublicKey] = useState<PublicKey | null>(
        () => CONFIGURED_SETUP_QUEUE_KEYPAIR?.publicKey ?? null,
    );

    // Transfer form state
    const [srcIndex, setSrcIndex] = useState(0);
    const [dstIndex, setDstIndex] = useState(1);
    const [amountStr, setAmountStr] = useState('1');
    const [mintRecipient, setMintRecipient] = useState('');
    const [queueMintAddress, setQueueMintAddress] = useState(() => mint?.toBase58() ?? '');
    const [transferVisibility, setTransferVisibility] = useState<'public' | 'private'>('public');
    const [fromBalance, setFromBalance] = useState<'base' | 'ephemeral'>('ephemeral');
    const [toBalance, setToBalance] = useState<'base' | 'ephemeral'>('ephemeral');
    const [privateMinDelayMs, setPrivateMinDelayMs] = useState('0');
    const [privateMaxDelayMs, setPrivateMaxDelayMs] = useState('0');
    const [privateSplitCount, setPrivateSplitCount] = useState('1');
    const [lamportsTransferDestination, setLamportsTransferDestination] = useState('');
    const [lamportsTransferAmount, setLamportsTransferAmount] = useState('1000000');

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

    useEffect(() => {
        return () => {
            if (autoSetupRetryTimeoutRef.current !== null) {
                clearTimeout(autoSetupRetryTimeoutRef.current);
            }
        };
    }, []);

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

    useEffect(() => {
        setQueueMintAddress(mint?.toBase58() ?? '');
    }, [mint]);

    const loadSetupQueueKeypair = useCallback(async (): Promise<Keypair | null> => {
        if (setupQueueKeypairRef.current) return setupQueueKeypairRef.current;
        if (!SETUP_QUEUE_KEYPAIR_ENV) return null;
        if (setupQueueKeypairPromiseRef.current) return setupQueueKeypairPromiseRef.current;

        const loadPromise = (async () => {
            const response = await fetch(resolveSetupQueueKeypairPath(SETUP_QUEUE_KEYPAIR_ENV));
            if (!response.ok) {
                throw new Error(
                    `Unable to load queue keypair from ${SETUP_QUEUE_KEYPAIR_ENV}: ${response.status} ${response.statusText}`,
                );
            }

            const keypair = parseSetupQueueKeypair(await response.json());
            setupQueueKeypairRef.current = keypair;
            setSetupQueueKeypairPublicKey(keypair.publicKey);
            return keypair;
        })().finally(() => {
            setupQueueKeypairPromiseRef.current = null;
        });

        setupQueueKeypairPromiseRef.current = loadPromise;
        return loadPromise;
    }, []);

    useEffect(() => {
        if (!SETUP_QUEUE_KEYPAIR_ENV) return;

        loadSetupQueueKeypair().catch((error) => {
            console.error('Failed to load setup queue keypair:', error);
        });
    }, [loadSetupQueueKeypair]);

    const ensureAirdropLamports = useCallback(async (conn: Connection, pubkey: PublicKey) => {
        try {
            const signature = await conn.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
            const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
            await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
        } catch {
            // ignore airdrop errors
        }
    }, []);

    const refreshBalances = useCallback(async () => {
        const eConn = ephemeralConnection.current;
        if (!mint) return;

        const updated = await Promise.all(accountsRef.current.map(async (acc) => {
            const ata = getAssociatedTokenAddressSync(mint, acc.keypair.publicKey, false, TOKEN_PROGRAM_ID);
            const [eAta] = deriveEphemeralAta(acc.keypair.publicKey, mint);

            let balance = 0n;
            let eDelegated: boolean | undefined;

            // Fetch L1 balance and delegation status
            try {
                const ai = await connection.getAccountInfo(ata, 'processed');
                if (ai) {
                    balance = parseTokenAmount(ai) ?? 0n;
                    const eAtaAcc = await connection.getAccountInfo(eAta, 'processed');
                    eDelegated = eAtaAcc?.owner.equals(DELEGATION_PROGRAM_ID);
                }
            } catch {
                // defaults are fine
            }

            // Fetch ephemeral balance
            let eBalance = 0n;
            if (eConn) {
                try {
                    const aiE = await eConn.getAccountInfo(ata, 'processed');
                    if (aiE) {
                        eBalance = parseTokenAmount(aiE) ?? 0n;
                    }
                } catch {
                    // default is fine
                }
            }

            // Fetch SOL balance
            let solLamports = 0n;
            try {
                const ownerInfo = await connection.getAccountInfo(acc.keypair.publicKey, 'processed');
                solLamports = BigInt(ownerInfo?.lamports ?? 0);
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

    // Subscribe to L1 ATA and wallet changes for live SPL and SOL updates
    useEffect(() => {
        const ids: number[] = [];

        for (const a of accountsRef.current) {
            if (a.ata) {
                try {
                    const ataId = connection.onAccountChange(
                        a.ata,
                        (accountInfo) => {
                            const amount = parseTokenAmount(accountInfo) ?? 0n;
                            setAccounts((prev) =>
                                prev.map((p) =>
                                    p.keypair.publicKey.equals(a.keypair.publicKey)
                                        ? { ...p, balance: amount }
                                        : p
                                )
                            );
                        },
                        "processed"
                    );

                    ids.push(ataId);
                } catch (_) {
                    /* ignore */
                }
            }

            try {
                const ownerId = connection.onAccountChange(
                    a.keypair.publicKey,
                    (accountInfo) => {
                        const lamports = BigInt(accountInfo.lamports);
                        setAccounts((prev) =>
                            prev.map((p) =>
                                p.keypair.publicKey.equals(a.keypair.publicKey)
                                    ? { ...p, solLamports: lamports }
                                    : p
                            )
                        );
                    },
                    "processed"
                );

                ids.push(ownerId);
            } catch (_) {
                /* ignore */
            }
        }

        return () => {
            ids.forEach((id) => {
                try {
                    connection.removeAccountChangeListener(id);
                } catch (_) {
                    /* ignore */
                }
            });
        };
    }, [accountKeysFingerprint, ataFingerprint, connection]);

    // Subscribe to ata changes on the ephemeral connection for each account
    useEffect(() => {
        const eConn = ephemeralConnection.current;
        if (!eConn || !mint) return;

        const ids: number[] = [];

        for (const a of accountsRef.current) {
            if (!a.ata) continue;

            try {
                const id = eConn.onAccountChange(
                    a.ata,
                    async (accountInfo) => {
                        try {
                            const amount = parseTokenAmount(accountInfo) ?? 0n;

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
    }, [accountKeysFingerprint, ataFingerprint, mint]);

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
        const usesEphemeralConnection = fromBalance === 'ephemeral';
        const usesQueuedPrivateTransfer =
            transferVisibility === 'private' && toBalance === 'base';
        if (!mint) {
            setTransactionError('Mint not initialized. Run Setup first.');
            return;
        }
        if ((fromBalance === 'ephemeral' || toBalance === 'ephemeral') && !eConn) return;
        const src = accounts[fromIdx];
        const dst = accounts[toIdx];
        if (!src || !dst) return setTransactionError('Invalid source/destination');
        if (fromIdx === toIdx) return setTransactionError('Source and destination must be different');
        const conn = usesEphemeralConnection ? eConn : connection;
        if (!conn) return;
        try {
            setIsSubmitting(true);
            const amountBn = parseAmount(amountUi, decimals);
            if (amountBn <= 0n) throw new Error('Invalid amount');

            let privateTransfer:
                | { minDelayMs: bigint; maxDelayMs: bigint; split: number; }
                // | { minDelayMs: bigint; maxDelayMs: bigint; split: number; clientRefId: bigint }
                | undefined;
            if (usesQueuedPrivateTransfer) {
                if (!validator.current) {
                    throw new Error('Validator not loaded yet for encrypted private transfers');
                }
                const minDelayMsNumber = Number(privateMinDelayMs);
                const maxDelayMsNumber = Number(privateMaxDelayMs);
                const splitCountNumber = Number(privateSplitCount);
                privateTransfer = {
                    minDelayMs: BigInt(minDelayMsNumber),
                    maxDelayMs: BigInt(maxDelayMsNumber),
                    split: splitCountNumber,
                    // Optional client reference ID, encrypted, can be used to confirm a payment
                    // clientRefId: BigInt(crypto.getRandomValues(new Uint32Array(1))[0]),
                };
            }

            const shuttleId = crypto.getRandomValues(new Uint32Array(1))[0];
            const transferIxs = await transferSpl(
                src.keypair.publicKey,
                dst.keypair.publicKey,
                mint,
                amountBn,
                {
                    visibility: transferVisibility,
                    fromBalance,
                    toBalance,
                    payer: src.keypair.publicKey,
                    validator: validator.current,
                    initIfMissing: true,
                    initAtasIfMissing: true,
                    initVaultIfMissing: false,
                    privateTransfer,
                    shuttleId
                },
            );

            const [shuttleEphemeralAta] = deriveShuttleEphemeralAta(
                src.keypair.publicKey,
                mint,
                shuttleId,
            );
            const shuttleWalletAta = deriveShuttleWalletAta(
                mint,
                shuttleEphemeralAta,
            );
            // User ATAslog pu
            const srcAta = getAssociatedTokenAddressSync(
                mint,
                src.keypair.publicKey
            );
            const dstAta = getAssociatedTokenAddressSync(
                mint,
                dst.keypair.publicKey
            );
            console.log("Shuttle wallet ata: ", shuttleWalletAta.toBase58());
            console.log("Shuttle eata: ", shuttleEphemeralAta.toBase58());
            console.log("Src ata: ", srcAta.toBase58());

            const ixs: TransactionInstruction[] = [
                createNoopInstruction(),
                ...transferIxs,
            ];

            let sig;
            if (usesEphemeralConnection) {
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
            setTransactionSuccess(`${usesQueuedPrivateTransfer ? 'Private transfer queued' : 'Transfer confirmed'}: ${sig.substring(0, 10)}...${sig.substring(sig.length - 10, sig.length)}`);
            console.log(
                "Transfer: ",
                sig,
                `(from ${src.keypair.publicKey.toBase58()} (sender ata: ${srcAta.toBase58()}), to ${dst.keypair.publicKey.toBase58()} (destination ata: ${dstAta.toBase58()}))`
            );
            await ephemeralConnection!.current!.getAccountInfo(shuttleWalletAta);
            await refreshBalances();
        } catch (e: any) {
            setTransactionError(await formatTransactionError(e, conn));
        } finally {
            setIsSubmitting(false);
        }
    }, [accounts, connection, decimals, fromBalance, getCachedEphemeralBlockhash, mint, privateMaxDelayMs, privateMinDelayMs, privateSplitCount, refreshBalances, toBalance, transferVisibility]);

    const handleTransfer = useCallback(async () => {
        await performTransfer(srcIndex, dstIndex, amountStr);
    }, [performTransfer, srcIndex, dstIndex, amountStr]);

    const setupAll = useCallback(async () => {
        const eConn = ephemeralConnection.current;
        if (!eConn) return;
        setTransactionError(null);
        setTransactionSuccess(null);
        const payer = accounts[0].keypair;
        const queueValidator = validator.current;
        if (!queueValidator) {
            if (autoSetupRetryTimeoutRef.current === null) {
                autoSetupRetryTimeoutRef.current = setTimeout(() => {
                    autoSetupRetryTimeoutRef.current = null;
                    setupAll().catch(console.error);
                }, 1000);
            }
            return;
        }
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
                const mint = mintKp.publicKey;
                const ataPubkeys = accounts.map(a => getAssociatedTokenAddressSync(mintKp.publicKey, a.keypair.publicKey));
                const [transferQueue] = deriveTransferQueue(mintKp.publicKey, queueValidator);
                const magicFeeVault = magicFeeVaultPdaFromValidator(queueValidator);
                const [vault] = deriveVault(mint);
                const [vaultEphemeralAta] = deriveEphemeralAta(vault, mint);
                const vaultAta = deriveVaultAta(mint, vault);

                const [rentPda] = deriveRentPda();
                console.log("Rent sponsor PDA: ", rentPda.toBase58());

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
                        queueValidator,
                    ),
                    initRentPdaIx(
                        payer.publicKey,
                        rentPda,
                    ),
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: rentPda,
                        lamports: LAMPORTS_PER_SOL / 10,
                    }),
                    delegateTransferQueueIx(
                        transferQueue,
                        payer.publicKey,
                        mintKp.publicKey,
                    ),
                );
                mintTx.feePayer = payer.publicKey;
                const setupVaultTx = new Transaction().add(
                    initVaultIx(vault, mint, payer.publicKey),
                    initVaultAtaIx(payer.publicKey, vaultAta, vault, mint),
                    delegateEphemeralAtaIx(payer.publicKey, vaultEphemeralAta, validator.current),

                );
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
                await sendAndConfirmTransaction(
                    conn,
                    setupVaultTx,
                    [payer],
                    {
                        commitment: 'confirmed',
                        preflightCommitment: 'confirmed',
                        skipPreflight: true,
                    },
                );
                console.log("Mint and queue setup tx: ", mintSig)

                console.log("Transfer queue: ", transferQueue.toBase58());

                const startCrankQueueTx = new Transaction().add(

                    ensureTransferQueueCrankIx(
                        payer.publicKey,
                        transferQueue,
                        magicFeeVault,
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
        if (SETUP_MINT_ENV) {
            if (!CONFIGURED_SETUP_MINT) {
                setTransactionError(`Invalid SETUP_MINT env value: ${SETUP_MINT_ENV}`);
                autoSetupTriggeredRef.current = true;
                return;
            }

            if (!mint || !mint.equals(CONFIGURED_SETUP_MINT)) {
                setMint(CONFIGURED_SETUP_MINT);
                setDecimals(6);
            }
            autoSetupTriggeredRef.current = true;
            return;
        }

        if (mint) return; // already set or loaded from storage
        if (autoSetupTriggeredRef.current) return; // guard against multiple triggers (e.g., StrictMode)
        autoSetupTriggeredRef.current = true;
        // Fire and forget; internal errors are surfaced via state
        setupAll().catch(console.error);
    }, [mint, setupAll]);

    const resetMint = useCallback(async () => {
        safeLocalStorage.remove(LS_MINT_KEY);
        setMint(CONFIGURED_SETUP_MINT);
        if (CONFIGURED_SETUP_MINT) {
            try {
                const mintInfo = await getMint(connection, CONFIGURED_SETUP_MINT, 'processed');
                setDecimals(mintInfo.decimals);
            } catch (_) {
                setDecimals(6);
            }
        } else {
            setDecimals(6);
        }
        setTransactionSuccess(
            CONFIGURED_SETUP_MINT
                ? 'Mint reset. Using configured setup mint.'
                : 'Mint reset. Run Setup to create a new mint.',
        );
        await refreshBalances();
    }, [connection, refreshBalances]);

    const handleMintToAddress = useCallback(async () => {
        setTransactionError(null);
        setTransactionSuccess(null);

        if (!mint) {
            setTransactionError('Mint not initialized. Run Setup first.');
            return;
        }

        const payer = accounts[0]?.keypair;
        if (!payer) {
            setTransactionError('Mint authority not available.');
            return;
        }

        const recipientText = mintRecipient.trim();
        if (!recipientText) {
            setTransactionError('Recipient public key is required.');
            return;
        }

        try {
            setIsSubmitting(true);
            await ensureAirdropLamports(connection, payer.publicKey);

            const recipient = new PublicKey(recipientText);
            const recipientAta = getAssociatedTokenAddressSync(mint, recipient, false, TOKEN_PROGRAM_ID);
            const recipientAtaInfo = await connection.getAccountInfo(recipientAta, 'processed');
            const amountBase = BigInt(1000) * BigInt(10) ** BigInt(decimals);

            const tx = new Transaction();
            if (!recipientAtaInfo) {
                tx.add(
                    createAssociatedTokenAccountInstruction(
                        payer.publicKey,
                        recipientAta,
                        recipient,
                        mint,
                    ),
                );
            }

            tx.add(
                createMintToInstruction(
                    mint,
                    recipientAta,
                    payer.publicKey,
                    amountBase,
                ),
            );
            tx.feePayer = payer.publicKey;

            const sig = await sendAndConfirmTransaction(
                connection,
                tx,
                [payer],
                {
                    commitment: 'confirmed',
                    preflightCommitment: 'confirmed',
                    skipPreflight: true,
                },
            );
            console.log("Mint to address tx:", sig);

            setMintRecipient('');
            setTransactionSuccess(
                `Minted 1000 tokens to ${recipient.toBase58()}: ${sig.substring(0, 10)}...${sig.substring(sig.length - 10)}`,
            );
            await refreshBalances();
        } catch (e: any) {
            setTransactionError(await formatTransactionError(e, connection));
        } finally {
            setIsSubmitting(false);
        }
    }, [accounts, connection, decimals, ensureAirdropLamports, mint, mintRecipient, refreshBalances]);

    const handleSetupQueue = useCallback(async () => {
        setTransactionError(null);
        setTransactionSuccess(null);

        const queueMintText = queueMintAddress.trim();
        if (!queueMintText) {
            setTransactionError('Queue mint public key is required.');
            return;
        }

        try {
            setIsSubmitting(true);
            const configuredQueuePayer = await loadSetupQueueKeypair();
            const payer = configuredQueuePayer ?? accounts[0]?.keypair;
            if (!payer) {
                setTransactionError('Queue payer not available.');
                return;
            }

            const queueValidator = validator.current;
            if (!queueValidator) {
                throw new Error('Validator not loaded yet for queue setup');
            }

            const minimumQueueSetupLamports = LAMPORTS_PER_SOL / 10 + LAMPORTS_PER_SOL / 100;
            let payerBalance = await connection.getBalance(payer.publicKey, 'confirmed');
            if (payerBalance < minimumQueueSetupLamports) {
                await ensureAirdropLamports(connection, payer.publicKey);
                payerBalance = await connection.getBalance(payer.publicKey, 'confirmed');
                if (payerBalance < minimumQueueSetupLamports) {
                    setTransactionError('Queue setup requires at least 0.11 SOL in the payer account.');
                    return;
                }
            }

            const queueMint = new PublicKey(queueMintText);
            const [transferQueue] = deriveTransferQueue(queueMint, queueValidator);
            const [rentPda] = deriveRentPda();
            console.log("Transfer queue:", transferQueue.toBase58());
            console.log("Rent pda: ", rentPda.toBase58());

            const tx = new Transaction().add(
                initTransferQueueIx(
                    payer.publicKey,
                    transferQueue,
                    queueMint,
                    queueValidator,
                ),
                initRentPdaIx(
                    payer.publicKey,
                    rentPda,
                ),
                SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: rentPda,
                    lamports: LAMPORTS_PER_SOL / 10,
                }),
                delegateTransferQueueIx(
                    transferQueue,
                    payer.publicKey,
                    queueMint,
                ),
            );
            tx.feePayer = payer.publicKey;

            const sig = await sendAndConfirmTransaction(
                connection,
                tx,
                [payer],
                {
                    commitment: 'confirmed',
                    preflightCommitment: 'confirmed',
                    skipPreflight: true,
                },
            );


            setTransactionSuccess(
                `Queue setup confirmed for ${queueMint.toBase58()}: ${sig.substring(0, 10)}...${sig.substring(sig.length - 10)}`,
            );
        } catch (e: any) {
            setTransactionError(await formatTransactionError(e, connection));
        } finally {
            setIsSubmitting(false);
        }
    }, [accounts, connection, ensureAirdropLamports, loadSetupQueueKeypair, queueMintAddress]);

    const handleStartQueueCrank = useCallback(async () => {
        setTransactionError(null);
        setTransactionSuccess(null);

        const eConn = ephemeralConnection.current;
        if (!eConn) {
            setTransactionError('Ephemeral connection not available.');
            return;
        }

        const queueMintText = queueMintAddress.trim();
        if (!queueMintText) {
            setTransactionError('Queue mint public key is required.');
            return;
        }

        try {
            setIsSubmitting(true);
            const configuredQueuePayer = await loadSetupQueueKeypair();
            const payer = configuredQueuePayer ?? accounts[0]?.keypair;
            if (!payer) {
                setTransactionError('Queue payer not available.');
                return;
            }

            const queueValidator = validator.current;
            if (!queueValidator) {
                throw new Error('Validator not loaded yet for queue crank');
            }

            const queueMint = new PublicKey(queueMintText);
            const [transferQueue] = deriveTransferQueue(queueMint, queueValidator);
            const magicFeeVault = magicFeeVaultPdaFromValidator(queueValidator);
            console.log("Transfer queue:", transferQueue.toBase58());

            const tx = new Transaction().add(
                ensureTransferQueueCrankIx(
                    payer.publicKey,
                    transferQueue,
                    magicFeeVault,
                ),
            );
            tx.feePayer = payer.publicKey;

            const sig = await sendAndConfirmTransaction(
                eConn,
                tx,
                [payer],
                {
                    commitment: 'confirmed',
                    preflightCommitment: 'confirmed',
                    skipPreflight: true,
                },
            );

            setTransactionSuccess(
                `Queue crank started for ${queueMint.toBase58()}: ${sig.substring(0, 10)}...${sig.substring(sig.length - 10)}`,
            );
        } catch (e: any) {
            setTransactionError(await formatTransactionError(e, eConn));
        } finally {
            setIsSubmitting(false);
        }
    }, [accounts, loadSetupQueueKeypair, queueMintAddress]);

    const handleLamportsTransfer = useCallback(async () => {
        setTransactionError(null);
        setTransactionSuccess(null);

        const destinationText = lamportsTransferDestination.trim();
        if (!destinationText) {
            setTransactionError('Lamports destination public key is required.');
            return;
        }

        const amountText = lamportsTransferAmount.trim();
        if (!/^\d+$/.test(amountText)) {
            setTransactionError('Lamports amount must be a whole number.');
            return;
        }

        try {
            setIsSubmitting(true);

            const configuredQueuePayer = await loadSetupQueueKeypair();
            const payer = configuredQueuePayer ?? accounts[0]?.keypair;
            if (!payer) {
                setTransactionError('Lamports payer not available.');
                return;
            }

            const destination = new PublicKey(destinationText);
            const amount = BigInt(amountText);
            if (amount <= 0n) {
                setTransactionError('Lamports amount must be greater than 0.');
                return;
            }

            const payerBalance = BigInt(await connection.getBalance(payer.publicKey, 'confirmed'));
            if (payerBalance <= amount) {
                setTransactionError('Lamports payer balance is too low for this transfer.');
                return;
            }

            const salt = crypto.getRandomValues(new Uint8Array(32));
            const [lamportsPda] = deriveLamportsPda(payer.publicKey, destination, salt);
            console.log("Lamports PDA:", lamportsPda.toBase58());

            const tx = new Transaction().add(
                lamportsDelegatedTransferIx(
                    payer.publicKey,
                    destination,
                    amount,
                    salt,
                ),
            );
            tx.feePayer = payer.publicKey;

            const sig = await sendAndConfirmTransaction(
                connection,
                tx,
                [payer],
                {
                    commitment: 'confirmed',
                    preflightCommitment: 'confirmed',
                    skipPreflight: true,
                },
            );

            setTransactionSuccess(
                `Lamports transfer submitted for ${destination.toBase58()} via ${lamportsPda.toBase58()}: ${sig.substring(0, 10)}...${sig.substring(sig.length - 10)}`,
            );
            await refreshBalances();
        } catch (e: any) {
            setTransactionError(await formatTransactionError(e, connection));
        } finally {
            setIsSubmitting(false);
        }
    }, [accounts, connection, lamportsTransferAmount, lamportsTransferDestination, loadSetupQueueKeypair, refreshBalances]);

    const lamportsTransferSender = setupQueueKeypairPublicKey ?? accounts[0]?.keypair.publicKey ?? null;

    return (
        <>
            <style>{`
              @media (max-width: 640px) {
                .counter-ui {
                  padding-left: 16px;
                  padding-right: 16px;
                }
              }

              .mint-panel-row {
                display: grid;
                grid-template-columns: max-content max-content minmax(0, 1fr);
                gap: 8px;
                align-items: center;
                width: 100%;
              }

              .mint-panel-actions {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
              }

              @media (max-width: 900px) {
                .mint-panel-row {
                  grid-template-columns: 1fr;
                  align-items: stretch;
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

                                        // Build instructions via SDK
                                        const shuttleId = crypto.getRandomValues(new Uint32Array(1))[0];
                                        const ixs = await delegateSpl(
                                            a.keypair.publicKey,
                                            mint,
                                            amountBn,
                                            {
                                                validator: validator.current,
                                                initIfMissing: true,
                                                initAtasIfMissing: true,
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

                                        const [shuttleEphemeralAta] = deriveShuttleEphemeralAta(
                                            a.keypair.publicKey,
                                            mint,
                                            shuttleId,
                                        );
                                        const shuttleWalletAta = deriveShuttleWalletAta(
                                            mint,
                                            shuttleEphemeralAta,
                                        );
                                        await eConn.getAccountInfo(shuttleWalletAta);

                                        console.log("Shuttle wallet ata: ", shuttleWalletAta.toBase58());
                                        console.log("Shuttle eata: ", shuttleEphemeralAta.toBase58());

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
                                    // Undelegate on Ephemeral first (if delegated), then withdraw on L1 in a single tx for this account
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

                                        // Withdraw on base chain for the requested amount
                                        const shuttleId = crypto.getRandomValues(new Uint32Array(1))[0];
                                        const ixsW = await withdrawSpl(a.keypair.publicKey, mint, amountBn, {
                                            idempotent: true,
                                            validator: validator.current,
                                            shuttleId
                                        });
                                        const txW = new Transaction().add(...ixsW);
                                        txW.feePayer = a.keypair.publicKey;
                                        const { blockhash: bhW } = await connection.getLatestBlockhash({commitment: "finalized"});
                                        txW.recentBlockhash = bhW;
                                        txW.sign(a.keypair);
                                        const sigW = await connection.sendRawTransaction(txW.serialize(), { skipPreflight: true });
                                        await connection.confirmTransaction(sigW, 'confirmed');

                                        setTransactionSuccess('Undelegation and withdraw confirmed');
                                        console.log("Undelegation: ", sigW);

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
                                        // await eConn.getAccountInfo(shuttleAta);
                                        await eConn.getAccountInfo(shuttleWalletAta);
                                        // await eConn.getAccountInfo(shuttleEphemeralAta);
                                        console.log("Shuttle wallet ata: ", shuttleWalletAta.toBase58());
                                        console.log("Shuttle eata: ", shuttleEphemeralAta.toBase58());
                                        console.log("Shuttle ata: ", shuttleAta.toBase58());
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

                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignItems: 'flex-start', marginTop: 24 }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12, marginBottom: -10 }}>
                                    Visibility
                                    <select
                                        value={transferVisibility}
                                        onChange={e => setTransferVisibility(e.target.value as 'public' | 'private')}
                                        style={{ ...INPUT_STYLE, width: 112, padding: '6px 8px' }}
                                    >
                                        <option value="public">Public</option>
                                        <option value="private">Private</option>
                                    </select>
                                </label>

                                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12 }}>
                                        From
                                        <select
                                            value={fromBalance}
                                            onChange={e => setFromBalance(e.target.value as 'base' | 'ephemeral')}
                                            style={{ ...INPUT_STYLE, width: 124, padding: '6px 8px' }}
                                        >
                                            <option value="base">Base</option>
                                            <option value="ephemeral">Ephemeral</option>
                                        </select>
                                    </label>

                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12 }}>
                                        To
                                        <select
                                            value={toBalance}
                                            onChange={e => setToBalance(e.target.value as 'base' | 'ephemeral')}
                                            style={{ ...INPUT_STYLE, width: 124, padding: '6px 8px' }}
                                        >
                                            <option value="base">Base</option>
                                            <option value="ephemeral">Ephemeral</option>
                                        </select>
                                    </label>

                                    <button
                                        onClick={handleTransfer}
                                        disabled={isSubmitting || !mint}
                                        style={{ ...BUTTON_STYLE, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}
                                    >
                                        {isSubmitting
                                            ? (transferVisibility === 'private' && toBalance === 'base' ? 'Queueing…' : 'Transferring…')
                                            : (transferVisibility === 'private' && toBalance === 'base' ? 'Queue Transfer' : 'Transfer')}
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12, opacity: transferVisibility === 'private' && toBalance === 'base' ? 1 : 0.5 }}>
                                    Min Delay (ms)
                                    <input
                                        type="number"
                                        min="0"
                                        step={1}
                                        value={privateMinDelayMs}
                                        disabled={!(transferVisibility === 'private' && toBalance === 'base')}
                                        onChange={e => setPrivateMinDelayMs(e.target.value)}
                                        style={{ ...INPUT_STYLE, width: 112, padding: '6px 8px' }}
                                    />
                                </label>

                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12, opacity: transferVisibility === 'private' && toBalance === 'base' ? 1 : 0.5 }}>
                                    Max Delay (ms)
                                    <input
                                        type="number"
                                        min="0"
                                        step={1}
                                        value={privateMaxDelayMs}
                                        disabled={!(transferVisibility === 'private' && toBalance === 'base')}
                                        onChange={e => setPrivateMaxDelayMs(e.target.value)}
                                        style={{ ...INPUT_STYLE, width: 96, padding: '6px 8px' }}
                                    />
                                </label>

                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12, opacity: transferVisibility === 'private' && toBalance === 'base' ? 1 : 0.5 }}>
                                    Split
                                    <input
                                        type="number"
                                        min="1"
                                        step={1}
                                        value={privateSplitCount}
                                        disabled={!(transferVisibility === 'private' && toBalance === 'base')}
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch', width: '100%' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12, flexWrap: 'wrap' }}>
                                Mint
                                <span style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>{short(mint)}</span>
                                <button
                                    onClick={() => copyPk(mint)}
                                    title="Copy mint address"
                                    style={{ ...COMPACT_BUTTON_STYLE, borderRadius: 6, padding: '4px 6px' }}
                                >Copy</button>
                                <button
                                    onClick={() => resetMint()}
                                    title="Reset mint"
                                    style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#fecaca', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', margin: 0, width: 'auto', whiteSpace: 'nowrap' }}
                                >Reset</button>
                            </div>
                            <div className="mint-panel-row">
                                <div className="mint-panel-actions">
                                    <button
                                        onClick={handleMintToAddress}
                                        disabled={isSubmitting || !mintRecipient.trim()}
                                        style={{ ...COMPACT_BUTTON_STYLE, cursor: isSubmitting || !mintRecipient.trim() ? 'not-allowed' : 'pointer', opacity: isSubmitting || !mintRecipient.trim() ? 0.6 : 1, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    >
                                        Mint 1000
                                    </button>
                                </div>
                                <div style={{ color: '#9ca3af', fontSize: 12, flexShrink: 0 }}>Recipient</div>
                                <input
                                    type="text"
                                    value={mintRecipient}
                                    onChange={e => setMintRecipient(e.target.value)}
                                    placeholder="Public key"
                                    style={{ ...INPUT_STYLE, minWidth: 0, width: '100%' }}
                                />
                            </div>
                            <div className="mint-panel-row">
                                <div className="mint-panel-actions">
                                    <button
                                        onClick={handleSetupQueue}
                                        disabled={isSubmitting || !queueMintAddress.trim()}
                                        style={{ ...COMPACT_BUTTON_STYLE, cursor: isSubmitting || !queueMintAddress.trim() ? 'not-allowed' : 'pointer', opacity: isSubmitting || !queueMintAddress.trim() ? 0.6 : 1, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    >
                                        Setup queue
                                    </button>
                                    <button
                                        onClick={handleStartQueueCrank}
                                        disabled={isSubmitting || !queueMintAddress.trim()}
                                        style={{ ...COMPACT_BUTTON_STYLE, cursor: isSubmitting || !queueMintAddress.trim() ? 'not-allowed' : 'pointer', opacity: isSubmitting || !queueMintAddress.trim() ? 0.6 : 1, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    >
                                        Start queue crank
                                    </button>
                                </div>
                                <div style={{ color: '#9ca3af', fontSize: 12, flexShrink: 0 }}>Queue Mint</div>
                                <input
                                    type="text"
                                    value={queueMintAddress}
                                    onChange={e => setQueueMintAddress(e.target.value)}
                                    placeholder="Mint public key"
                                    style={{ ...INPUT_STYLE, minWidth: 0, width: '100%' }}
                                />
                            </div>
                            {setupQueueKeypairPublicKey && (
                                <div style={{ color: '#9ca3af', fontSize: 12, wordBreak: 'break-all' }}>
                                    Queue signer override{' '}
                                    <span style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>
                                        {setupQueueKeypairPublicKey.toBase58()}
                                    </span>
                                </div>
                            )}
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

            <div style={{ height: 24 }} />

            <div style={CARD_STYLE}>
                <div style={{ height: 4, borderRadius: 999, background: 'linear-gradient(90deg,#22d3ee,#a78bfa)', marginBottom: 12, opacity: 0.9 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ color: '#e5e7eb', fontSize: 14, fontWeight: 600 }}>
                        Lamports transfer
                    </div>
                    {lamportsTransferSender && (
                        <div style={{ color: '#9ca3af', fontSize: 12, wordBreak: 'break-all' }}>
                            Sender{' '}
                            <span style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>
                                {lamportsTransferSender.toBase58()}
                            </span>
                            {setupQueueKeypairPublicKey ? ' (queue override)' : ' (account #1)'}
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12 }}>
                            Lamports
                            <input
                                type="text"
                                inputMode="numeric"
                                value={lamportsTransferAmount}
                                onChange={e => setLamportsTransferAmount(e.target.value.replace(/[^0-9]/g, ''))}
                                placeholder="1000000"
                                style={{ ...INPUT_STYLE, width: 140 }}
                            />
                        </label>

                        <button
                            onClick={handleLamportsTransfer}
                            disabled={isSubmitting || !lamportsTransferDestination.trim() || !lamportsTransferAmount.trim()}
                            style={{ ...BUTTON_STYLE, cursor: isSubmitting || !lamportsTransferDestination.trim() || !lamportsTransferAmount.trim() ? 'not-allowed' : 'pointer', opacity: isSubmitting || !lamportsTransferDestination.trim() || !lamportsTransferAmount.trim() ? 0.6 : 1 }}
                        >
                            Transfer lamports
                        </button>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12, flex: '1 1 320px' }}>
                            Destination
                            <input
                                type="text"
                                value={lamportsTransferDestination}
                                onChange={e => setLamportsTransferDestination(e.target.value)}
                                placeholder="Public key"
                                style={{ ...INPUT_STYLE, minWidth: 0, width: '100%' }}
                            />
                        </label>
                    </div>
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
