import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import Button from "./components/Button";
import Square from "./components/Square";
import {useConnection, useWallet} from '@solana/wallet-adapter-react';
import {WalletMultiButton} from "@solana/wallet-adapter-react-ui";
import Alert from "./components/Alert";
import {Idl, Program, Provider} from "@coral-xyz/anchor";
import {SimpleProvider} from "./components/Wallet";
import {
    AccountInfo,
    Commitment,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    Transaction,
    TransactionInstruction,
} from "@solana/web3.js";
import {
    getAuthToken,
    permissionPdaFromAccount,
    PERMISSION_PROGRAM_ID,
    MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
// IDL is copied into src/idl/ by the `copy-idl` npm script (runs as prebuild/prestart).
import privateCounterIdl from "./idl/private_counter.json";

const COUNTER_PDA_SEED = "counter";
const VAULT_ID = new PublicKey("MagicVau1t999999999999999999999999999999999");
// TEE validator identity — the private counter must be delegated to this specific
// validator so the ER runs inside an attested enclave.
const TEE_VALIDATOR = new PublicKey(
    process.env.REACT_APP_VALIDATOR || "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
);
// Program ID comes from the local IDL so it stays in sync with declare_id! after redeploys.
const COUNTER_PROGRAM = new PublicKey(privateCounterIdl.address);
console.log("Private counter program:", COUNTER_PROGRAM.toBase58());
// Default to the TEE ER endpoint. Requires an auth token bound to the counter's
// authority — we use the tempKeypair (session key) as authority, so the token is
// signed locally with the tempKeypair's secretKey. No wallet popup needed.
const PRIVATE_ER_ENDPOINT = (process.env.REACT_APP_TEE_PROVIDER_ENDPOINT || "https://devnet-tee.magicblock.app").replace(/\/$/, "");
const PRIVATE_ER_WS_ENDPOINT = process.env.REACT_APP_TEE_WS_ENDPOINT || PRIVATE_ER_ENDPOINT.replace(/^http/, "ws");

const App: React.FC = () => {
    const { connection } = useConnection();
    const ephemeralConnection = useRef<Connection | null>(null);
    const provider = useRef<Provider>(new SimpleProvider(connection));
    const { publicKey, signMessage } = useWallet();
    const [counter, setCounter] = useState<number>(0);
    const [ephemeralCounter, setEphemeralCounter] = useState<number>(0);
    const [isDelegated, setIsDelegated] = useState<boolean>(false);
    const [isPrivate, setIsPrivate] = useState<boolean>(false);
    // Auth token surfaced into render so the explorer link can embed it. Refreshed
    // on every privacy toggle — the toggle button IS the "sign for explorer access"
    // gesture, and the resulting token is baked into the URL below.
    const [explorerToken, setExplorerToken] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [transactionError, setTransactionError] = useState<{ message: string; explorerUrl?: string } | null>(null);
    const [transactionSuccess, setTransactionSuccess] = useState<{ message: string; explorerUrl?: string } | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const counterProgramClient = useRef<Program | null>(null);
    const counterSubscriptionId = useRef<number | null>(null);
    const ephemeralCounterSubscriptionId = useRef<number | null>(null);
    const permissionSubscriptionId = useRef<number | null>(null);
    const authTokenCache = useRef<{ pubkey: string; token: string; expiresAt: number } | null>(null);
    const authTokenInFlight = useRef<Promise<string | null> | null>(null);

    // Deterministic session key derived from the wallet pubkey. Same wallet always
    // gets the same tempKeypair across browsers/devices — no localStorage needed.
    // SECURITY NOTE (demo only): because the seed is the wallet's public pubkey,
    // the tempKeypair's secret is publicly derivable. Fine for a demo where the
    // tempKeypair owns its own per-wallet counter; for prod, use a random keypair
    // stored in localStorage.
    const tempKeypair = useMemo(
        () => (publicKey ? Keypair.fromSeed(publicKey.toBytes()) : null),
        [publicKey],
    );

    // counterPda is per-authority. With tempKeypair as authority, the wallet never
    // signs program ixs — it only funds the tempKeypair (one airdrop on devnet, or a
    // manual SOL transfer on mainnet).
    const counterPda = useMemo(() => {
        if (!tempKeypair) return null;
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from(COUNTER_PDA_SEED), tempKeypair.publicKey.toBuffer()],
            COUNTER_PROGRAM,
        );
        return pda;
    }, [tempKeypair]);

    const permissionPda = useMemo(() => {
        if (!counterPda) return null;
        return permissionPdaFromAccount(counterPda);
    }, [counterPda]);

    const getProgramClient = useCallback(async (): Promise<Program> => {
        return new Program(privateCounterIdl as Idl, provider.current);
    }, []);

    const handleCounterChange = useCallback((accountInfo: AccountInfo<Buffer>) => {
        if (!counterProgramClient.current) return;
        const decodedData = counterProgramClient.current.coder.accounts.decode('counter', accountInfo.data);
        setIsDelegated(!accountInfo.owner.equals(counterProgramClient.current.programId));
        setCounter(Number(decodedData.count));
    }, []);

    const handleEphemeralCounterChange = useCallback((accountInfo: AccountInfo<Buffer>) => {
        if (!counterProgramClient.current) return;
        const decodedData = counterProgramClient.current.coder.accounts.decode('counter', accountInfo.data);
        setEphemeralCounter(Number(decodedData.count));
    }, []);

    const subscribeToCounter = useCallback(async (): Promise<void> => {
        if (!counterPda) return;
        if (counterSubscriptionId.current !== null) {
            try { await connection.removeAccountChangeListener(counterSubscriptionId.current); } catch {}
        }
        console.log("Subscribing to counter", counterPda.toBase58());
        counterSubscriptionId.current = connection.onAccountChange(counterPda, handleCounterChange, 'processed');
    }, [connection, counterPda, handleCounterChange]);

    const subscribeToEphemeralCounter = useCallback(async (): Promise<void> => {
        if (!ephemeralConnection.current || !counterPda) return;
        if (ephemeralCounterSubscriptionId.current !== null) {
            try { await ephemeralConnection.current.removeAccountChangeListener(ephemeralCounterSubscriptionId.current); } catch {}
        }
        console.log("Subscribing to ephemeral counter", counterPda.toBase58());
        ephemeralCounterSubscriptionId.current = ephemeralConnection.current.onAccountChange(counterPda, handleEphemeralCounterChange, 'processed');
    }, [counterPda, handleEphemeralCounterChange]);

    // EphemeralPermission layout (from the SDK):
    //   byte  0    : discriminator
    //   byte  1    : bump
    //   bytes 2-33 : permissioned_account pubkey
    //   byte  34   : is_private (0 = public, 1 = private)
    //   bytes 35+  : members[] (1 byte flags + 32 byte pubkey each)
    const handlePermissionChange = useCallback((accountInfo: AccountInfo<Buffer>) => {
        if (accountInfo.data.length >= 35) {
            setIsPrivate(accountInfo.data[34] === 1);
        }
    }, []);

    const subscribeToPermission = useCallback(async (): Promise<void> => {
        if (!ephemeralConnection.current || !permissionPda) return;
        if (permissionSubscriptionId.current !== null) {
            try { await ephemeralConnection.current.removeAccountChangeListener(permissionSubscriptionId.current); } catch {}
        }
        console.log("Subscribing to ephemeral permission", permissionPda.toBase58());
        permissionSubscriptionId.current = ephemeralConnection.current.onAccountChange(permissionPda, handlePermissionChange, 'processed');
    }, [permissionPda, handlePermissionChange]);

    /**
     * Acquire a TEE auth token signed by the user's WALLET (Phantom popup).
     * Used for the explorer link below — the wallet pubkey is registered as a
     * permission member via the delegate / set_privacy ixs, so a wallet-bound
     * token is what the TEE will accept for that pubkey's reads.
     */
    const ensureWalletAuthToken = useCallback(async (): Promise<string | null> => {
        if (!publicKey || !signMessage) return null;
        try {
            console.log("Requesting TEE auth token (wallet signature)");
            const result = await getAuthToken(
                PRIVATE_ER_ENDPOINT,
                publicKey,
                (message: Uint8Array) => signMessage(message),
            );
            console.log(
                "TEE Explorer URL:",
                `https://explorer.solana.com/?cluster=custom&customUrl=${PRIVATE_ER_ENDPOINT}?token=${result.token}`,
            );
            return result.token;
        } catch (e) {
            console.error("Failed to get wallet-signed TEE auth token:", e);
            return null;
        }
    }, [publicKey, signMessage]);

    /**
     * Acquire a TEE auth token tied to the tempKeypair (the counter's authority).
     * Signed locally with the tempKeypair's secretKey — no wallet popup.
     * Cached per pubkey with in-flight dedupe.
     */
    const ensureAuthToken = useCallback(async (): Promise<string | null> => {
        if (!tempKeypair) return null;
        const cached = authTokenCache.current;
        if (cached && cached.pubkey === tempKeypair.publicKey.toBase58() && cached.expiresAt > Date.now() / 1000 + 30) {
            return cached.token;
        }
        if (authTokenInFlight.current) return authTokenInFlight.current;
        authTokenInFlight.current = (async () => {
            try {
                console.log("Requesting TEE auth token (signed by tempKeypair)");
                const result = await getAuthToken(
                    PRIVATE_ER_ENDPOINT,
                    tempKeypair.publicKey,
                    (message: Uint8Array) => Promise.resolve(nacl.sign.detached(message, tempKeypair.secretKey)),
                );
                authTokenCache.current = {
                    pubkey: tempKeypair.publicKey.toBase58(),
                    token: result.token,
                    expiresAt: result.expiresAt,
                };
                console.log(
                    "TEE Explorer URL:",
                    `https://explorer.solana.com/?cluster=custom&customUrl=${PRIVATE_ER_ENDPOINT}?token=${result.token}`,
                );
                return result.token;
            } catch (e) {
                console.error("Failed to get TEE auth token:", e);
                return null;
            } finally {
                authTokenInFlight.current = null;
            }
        })();
        return authTokenInFlight.current;
    }, [tempKeypair]);

    // Init program client + base layer state, then ER connection (with TEE auth token)
    useEffect(() => {
        let cancelled = false;
        const init = async () => {
            if (!publicKey || !counterPda || !tempKeypair) {
                setIsLoading(false);
                return;
            }
            console.log("Wallet:", publicKey.toBase58());
            console.log("TempKeypair (counter authority):", tempKeypair.publicKey.toBase58());
            if (!counterProgramClient.current) {
                const client = await getProgramClient();
                if (cancelled) return;
                counterProgramClient.current = client;
            }
            const accountInfo = await provider.current.connection.getAccountInfo(counterPda);
            if (cancelled) return;
            if (accountInfo) {
                try {
                    const c = counterProgramClient.current!.coder.accounts.decode('counter', accountInfo.data);
                    setCounter(Number(c.count.valueOf()));
                    setIsDelegated(!accountInfo.owner.equals(COUNTER_PROGRAM));
                } catch { /* may fail mid-transition */ }
            }
            await subscribeToCounter();
            setIsLoading(false);

            const token = await ensureAuthToken();
            if (cancelled || !token) return;
            const erRpcUrl = `${PRIVATE_ER_ENDPOINT}?token=${token}`;
            const erWsUrl = `${PRIVATE_ER_WS_ENDPOINT}?token=${token}`;
            ephemeralConnection.current = new Connection(erRpcUrl, {
                wsEndpoint: erWsUrl,
                commitment: "confirmed",
            });

            try {
                await ephemeralConnection.current.requestAirdrop(counterPda, 1);
            } catch {
                console.log("Refreshed account in the ephemeral");
            }

            const erAccountInfo = await ephemeralConnection.current.getAccountInfo(counterPda);
            if (cancelled) return;
            if (erAccountInfo && counterProgramClient.current) {
                try {
                    const c = counterProgramClient.current.coder.accounts.decode("counter", erAccountInfo.data);
                    setEphemeralCounter(Number(c.count.valueOf()));
                } catch { /* not yet delegated / stale */ }
            }
            await subscribeToEphemeralCounter();

            if (permissionPda) {
                const permInfo = await ephemeralConnection.current.getAccountInfo(permissionPda);
                if (!cancelled && permInfo && permInfo.data.length >= 35) {
                    setIsPrivate(permInfo.data[34] === 1);
                }
                await subscribeToPermission();
            }
        };
        init().catch(console.error);
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [publicKey, counterPda, tempKeypair]);

    /**
     * Top up the tempKeypair (and the wallet itself) on devnet. On mainnet the user
     * would need to send SOL to the tempKeypair pubkey manually.
     */
    const transferToTempKeypair = useCallback(async () => {
        if (!publicKey || !tempKeypair) return;
        console.log("Topup wallets (devnet airdrop)");
        try { await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL); } catch (e) { console.warn("wallet airdrop failed", e); }
        try { await connection.requestAirdrop(tempKeypair.publicKey, LAMPORTS_PER_SOL); } catch (e) { console.warn("tempKeypair airdrop failed", e); }
    }, [publicKey, connection, tempKeypair]);

    useEffect(() => {
        const checkAndTransfer = async () => {
            if (!tempKeypair) return;
            const accountTmpWallet = await connection.getAccountInfo(tempKeypair.publicKey);
            if (!accountTmpWallet || accountTmpWallet.lamports <= 0.01 * LAMPORTS_PER_SOL) {
                await transferToTempKeypair();
            }
        };
        checkAndTransfer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDelegated, connection, tempKeypair]);

    /**
     * Submit a transaction signed by the tempKeypair. Used for ALL counter ops —
     * the tempKeypair is the counter's authority, so no wallet popup is ever needed
     * (other than for the initial connection / wallet's own airdrop).
     */
    const submitTransaction = useCallback(async (
        transaction: Transaction,
        ephemeral: boolean = false,
        confirmCommitment: Commitment = "processed",
        watchAccount?: PublicKey,
    ): Promise<string | null> => {
        if (!tempKeypair) return null;
        if (ephemeral && !ephemeralConnection.current) {
            setTransactionError({ message: "TEE ER connection not ready — auth token missing" });
            return null;
        }
        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        const targetConnection = ephemeral ? ephemeralConnection.current! : provider.current.connection;
        const layerLabel = ephemeral ? "ER" : "Base";
        // Hoist signature so the catch handler can include the explorer link for
        // failed-on-chain txs (much easier to debug with a clickable link).
        let signature: string | null = null;
        try {
            const { value: { blockhash, lastValidBlockHeight } } = await targetConnection.getLatestBlockhashAndContext();
            if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
            if (!transaction.feePayer) transaction.feePayer = tempKeypair.publicKey;
            transaction.sign(tempKeypair);

            const sendStart = performance.now();
            signature = await targetConnection.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
            const sendMs = Math.round(performance.now() - sendStart);

            const confirmStart = performance.now();
            const sigConfirm = await targetConnection.confirmTransaction(
                { signature, blockhash, lastValidBlockHeight },
                confirmCommitment,
            );
            if (sigConfirm.value.err) {
                throw new Error(`Transaction failed on chain: ${JSON.stringify(sigConfirm.value.err)}`);
            }
            const confirmMs = Math.round(performance.now() - confirmStart);

            let refreshMs = 0;
            if (watchAccount && counterProgramClient.current && counterPda && watchAccount.equals(counterPda)) {
                const refreshStart = performance.now();
                try {
                    const accountInfo = await targetConnection.getAccountInfo(watchAccount);
                    if (accountInfo) {
                        const c = counterProgramClient.current.coder.accounts.decode("counter", accountInfo.data);
                        const value = Number(c.count.valueOf());
                        if (ephemeral) setEphemeralCounter(value);
                        else {
                            setCounter(value);
                            setIsDelegated(!accountInfo.owner.equals(counterProgramClient.current.programId));
                        }
                    }
                } catch { /* decode may fail mid-transition (e.g., during delegate ownership flip) */ }
                refreshMs = Math.round(performance.now() - refreshStart);
            }

            const totalMs = sendMs + confirmMs + refreshMs;
            console.log(
                `[${layerLabel}] ${totalMs}ms total = send ${sendMs}ms + confirmTransaction(${confirmCommitment}) ${confirmMs}ms + refresh ${refreshMs}ms · sig ${signature}`,
            );

            // Build an explorer URL so the success Alert can link to tx details.
            // ER txs need a TEE auth token in the customUrl; use the tempKeypair-
            // signed one from ensureAuthToken (cached → instant, no popup). Base
            // txs go to the standard devnet explorer.
            let explorerUrl: string | undefined;
            if (ephemeral) {
                const token = await ensureAuthToken();
                if (token) {
                    explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(PRIVATE_ER_ENDPOINT + '?token=' + token)}`;
                }
            } else {
                explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
            }

            setTransactionSuccess({
                message: `[${layerLabel}] confirmed in ${totalMs}ms`,
                explorerUrl,
            });
            return signature;
        } catch (error) {
            // If the tx made it on-chain (signature was returned by sendRawTransaction),
            // attach an explorer link so the user can inspect the failure logs.
            let explorerUrl: string | undefined;
            if (signature) {
                if (ephemeral) {
                    const token = await ensureAuthToken();
                    if (token) {
                        explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(PRIVATE_ER_ENDPOINT + '?token=' + token)}`;
                    }
                } else {
                    explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
                }
            }
            setTransactionError({
                message: `Transaction failed: ${error}`,
                explorerUrl,
            });
        } finally {
            setIsSubmitting(false);
        }
        return null;
    }, [tempKeypair, counterPda, ensureAuthToken]);

    /**
     * Increment the counter. If counter PDA doesn't exist on base yet, prepends
     * initialize. Signed by tempKeypair in both cases — no wallet popup.
     */
    const increaseCounterTx = useCallback(async () => {
        if (!tempKeypair || !counterPda || !counterProgramClient.current) return;
        if (!isDelegated) {
            const accountTmpWallet = await connection.getAccountInfo(tempKeypair.publicKey);
            if (!accountTmpWallet || accountTmpWallet.lamports <= 0.01 * LAMPORTS_PER_SOL) {
                await transferToTempKeypair();
            }
        }

        const transaction = await counterProgramClient.current.methods
            .increment()
            .accounts({ counter: counterPda })
            .transaction() as Transaction;

        if (!isDelegated) {
            const accountInfo = await connection.getAccountInfo(counterPda);
            if (!accountInfo) {
                console.log("Counter not initialized, prepending initialize instruction");
                const initIx = await counterProgramClient.current.methods
                    .initialize()
                    .accounts({ authority: tempKeypair.publicKey })
                    .instruction();
                transaction.instructions.unshift(initIx);
            }
        }

        const noopInstruction = new TransactionInstruction({
            programId: new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'),
            keys: [],
            data: Buffer.from(crypto.getRandomValues(new Uint8Array(5))),
        });
        transaction.add(noopInstruction);

        const commitment = isDelegated ? "processed" : "confirmed";
        await submitTransaction(transaction, isDelegated, commitment, counterPda);
    }, [tempKeypair, isDelegated, counterPda, submitTransaction, connection, transferToTempKeypair]);

    const updateCounter = async (_: number): Promise<void> => {
        await increaseCounterTx();
    };

    /**
     * Delegate the private counter to the TEE validator. The program's `delegate` ix
     * bundles create_permission + delegate_permission + delegate_counter into a single
     * base-layer tx, so this is one signature with no follow-up ER call required.
     */
    const delegatePdaTx = useCallback(async () => {
        if (!tempKeypair || !publicKey || !counterProgramClient.current || !counterPda) return;
        console.log("Delegate private counter to TEE validator", TEE_VALIDATOR.toBase58());

        const delegateTx = await counterProgramClient.current.methods
            .delegate()
            .accountsPartial({
                authority: tempKeypair.publicKey,
                counter: counterPda,
                validator: TEE_VALIDATOR,
            })
            .transaction() as Transaction;
        setEphemeralCounter(Number(counter));
        const delegateSig = await submitTransaction(delegateTx, false, "confirmed", counterPda);
        if (!delegateSig) return;

        // Lazily build the ER connection so subsequent ER ops (Set Private / Check
        // Explorer) have a destination. The permission isn't created here — Set
        // Private handles that, prepending an init_permission ix into the
        // set_privacy tx if missing.
        if (!ephemeralConnection.current) {
            const token = await ensureAuthToken();
            if (!token) return;
            ephemeralConnection.current = new Connection(`${PRIVATE_ER_ENDPOINT}?token=${token}`, {
                wsEndpoint: `${PRIVATE_ER_WS_ENDPOINT}?token=${token}`,
                commitment: "confirmed",
            });
            await subscribeToEphemeralCounter();
        }
    }, [tempKeypair, publicKey, counter, counterPda, submitTransaction, ensureAuthToken, subscribeToEphemeralCounter]);

    /**
     * Toggle the ER permission's `is_private` flag. When private, only the counter's
     * authority (the tempKeypair, granted full read flags during delegate) can read
     * the ER state — other wallets see nothing. Authority members are reset on each
     * call so the user never locks themselves out.
     */
    const togglePrivacyTx = useCallback(async () => {
        if (!tempKeypair || !counterPda || !permissionPda || !counterProgramClient.current) return;
        if (!ephemeralConnection.current) {
            setTransactionError({ message: "ER connection not ready" });
            return;
        }
        const next = !isPrivate;

        // Build the set_privacy tx, then prepend init_permission as a first ix if
        // the permission doesn't exist on the ER yet. Both ixs land atomically in
        // one tx — no need for a separate confirm round-trip.
        const tx = await counterProgramClient.current.methods
            .setPrivacy(next)
            .accountsPartial({
                authority: tempKeypair.publicKey,
                counter: counterPda,
                permission: permissionPda,
                permissionProgram: PERMISSION_PROGRAM_ID,
                ephemeralVault: VAULT_ID,
                magicProgram: MAGIC_PROGRAM_ID,
            })
            .transaction() as Transaction;

        const permInfo = await ephemeralConnection.current.getAccountInfo(permissionPda);
        if (!permInfo) {
            console.log("Permission missing — prepending init_permission ix");
            const initIx = await counterProgramClient.current.methods
                .initPermission()
                .accountsPartial({
                    authority: tempKeypair.publicKey,
                    counter: counterPda,
                    permission: permissionPda,
                    permissionProgram: PERMISSION_PROGRAM_ID,
                    ephemeralVault: VAULT_ID,
                    magicProgram: MAGIC_PROGRAM_ID,
                })
                .instruction();
            tx.instructions.unshift(initIx);
        }

        // tempKeypair signs and submits to the TEE. The wallet is NOT touched here —
        // wallet auth is handled by the separate "Check Explorer" button.
        console.log(`tempKeypair signs set_privacy(${next})${!permInfo ? " + init_permission" : ""} → TEE`);
        const sig = await submitTransaction(tx, true, "processed");
        if (!sig) return;
        setIsPrivate(next); // optimistic — permission WS sub will reconcile
    }, [tempKeypair, counterPda, permissionPda, isPrivate, submitTransaction]);

    /**
     * "Open as Tester" — separate from Hide/Show. Wallet signs the TEE auth token
     * (Phantom popup), then opens the counter's TEE-explorer URL with that token
     * embedded. The wallet is intentionally NOT a permission member: when private,
     * the TEE rejects this token and the explorer shows nothing; when public, the
     * counter is visible. Same URL, different result based on the on-chain flag.
     */
    const openExplorerAsWallet = useCallback(async () => {
        if (!counterPda) return;
        // Reuse cached wallet token if still fresh (>30s left), else sign again.
        const cached = explorerToken;
        let token = cached;
        if (!token) {
            const fresh = await ensureWalletAuthToken();
            if (!fresh) {
                setTransactionError({ message: "Wallet declined the auth token" });
                return;
            }
            token = fresh;
            setExplorerToken(fresh);
        }
        const url = `https://explorer.solana.com/address/${counterPda.toBase58()}?cluster=custom&customUrl=${encodeURIComponent(PRIVATE_ER_ENDPOINT + '?token=' + token)}`;
        console.log(`Opening as wallet ${publicKey?.toBase58()}: ${url}`);
        window.open(url, "_blank", "noopener,noreferrer");
    }, [counterPda, explorerToken, ensureWalletAuthToken, publicKey]);

    /**
     * Undelegate (commit + release) the counter from the ER back to the base layer.
     */
    const undelegatePdaTx = useCallback(async () => {
        if (!tempKeypair || !counterProgramClient.current || !counterPda) return;
        console.log("Undelegate private counter");

        const tx = await counterProgramClient.current.methods
            .undelegate()
            .accounts({
                payer: tempKeypair.publicKey,
                counter: counterPda,
            })
            .transaction() as Transaction;

        await submitTransaction(tx, true, "processed", counterPda);
    }, [tempKeypair, counterPda, submitTransaction]);

    const delegateTx = useCallback(async () => {
        await delegatePdaTx();
    }, [delegatePdaTx]);

    const undelegateTx = useCallback(async () => {
        await undelegatePdaTx();
    }, [undelegatePdaTx]);

    const togglePrivacy = useCallback(async () => {
        await togglePrivacyTx();
    }, [togglePrivacyTx]);

    const openAsTester = useCallback(async () => {
        await openExplorerAsWallet();
    }, [openExplorerAsWallet]);

    return (
        <div className="counter-ui">
            <div className="wallet-buttons">
                <WalletMultiButton/>
            </div>

            <h1>Private Counter (TEE)</h1>

            <div className="delegate-buttons">
                <Button title={"Delegate"} resetGame={delegateTx} disabled={isDelegated || !publicKey}/>
                <Button title={"Undelegate"} resetGame={undelegateTx} disabled={!isDelegated || !publicKey}/>
            </div>

            <div className="game">
                <div className="counter-cell">
                    <Square
                        key="0"
                        ind={Number(0)}
                        updateSquares={(index: string | number) => updateCounter(Number(index))}
                        clsName={isDelegated ? '' : counter.toString()}
                        loading={isLoading}
                    />
                </div>
                <div className={`counter-cell ${isDelegated && isPrivate ? "is-private" : ""}`}>
                    <Square
                        key="1"
                        ind={Number(1)}
                        updateSquares={(index: string | number) => updateCounter(Number(index))}
                        clsName={isDelegated ? ephemeralCounter.toString() : ''}
                        loading={isLoading}
                    />
                    {isDelegated && (
                        <>
                            <label className={`privacy-toggle counter-cell-toggle ${(!publicKey || isSubmitting) ? "is-disabled" : ""}`}>
                                <span className="privacy-toggle-label" aria-label="public">🌐</span>
                                <input
                                    type="checkbox"
                                    checked={isPrivate}
                                    onChange={() => togglePrivacy()}
                                    disabled={!publicKey || isSubmitting}
                                />
                                <span className="privacy-toggle-slider" aria-hidden="true"></span>
                                <span className="privacy-toggle-label" aria-label="private">🔒</span>
                            </label>
                            <Button
                                title={"Explorer ↗"}
                                resetGame={openAsTester}
                                disabled={!publicKey || isSubmitting}
                            />
                        </>
                    )}
                </div>
            </div>

            {isSubmitting && (
                <div style={{
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
                </div>
            )}

            {transactionError &&
                <Alert
                    type="error"
                    message={transactionError.message}
                    href={transactionError.explorerUrl}
                    onClose={() => setTransactionError(null)}
                />}

            {transactionSuccess &&
                <Alert
                    type="success"
                    message={transactionSuccess.message}
                    href={transactionSuccess.explorerUrl}
                    onClose={() => setTransactionSuccess(null)}
                />}

            <img src={`${process.env.PUBLIC_URL}/magicblock_white.png`} alt="Magic Block Logo"
                 className="magicblock-logo"/>
        </div>
    );
};

export default App;
