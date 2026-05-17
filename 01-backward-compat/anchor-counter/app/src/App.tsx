import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import Button from "./components/Button";
import Square from "./components/Square";
import {useConnection, useWallet} from '@solana/wallet-adapter-react';
import {WalletMultiButton} from "@solana/wallet-adapter-react-ui";
import Alert from "./components/Alert";
import {Program, Provider} from "@coral-xyz/anchor";
import {SimpleProvider} from "./components/Wallet";
import {
    AccountInfo,
    Commitment,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    Transaction,
    TransactionInstruction
} from "@solana/web3.js";
import {getAuthToken} from "@magicblock-labs/ephemeral-rollups-sdk";

const COUNTER_PDA_SEED = "counter";
const PUBLIC_COUNTER_PROGRAM = new PublicKey("9RPwaXayVZHna1BYuRS4cLPJZuNGU1uS5V3heXB7v6Qi");
const PRIVATE_COUNTER_PROGRAM = new PublicKey("91L33vBqfNaNfieqNCoqpxGZ2xVyJ29N3VcErR6LoepZ");
const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
const PUBLIC_ER_ENDPOINT = process.env.REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app";
const TEE_ENDPOINT = (process.env.REACT_APP_TEE_PROVIDER_ENDPOINT || "https://devnet-tee.magicblock.app").replace(/\/$/, "");
const TEE_WS_ENDPOINT = TEE_ENDPOINT.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");

const App: React.FC = () => {
    const { connection } = useConnection();
    const ephemeralConnection = useRef<Connection | null>(null);
    const provider = useRef<Provider>(new SimpleProvider(connection));
    const { publicKey, sendTransaction, signMessage } = useWallet();
    const tempKeypair = useRef<Keypair | null>(null);
    const [counter, setCounter] = useState<number>(0);
    const [ephemeralCounter, setEphemeralCounter] = useState<number>(0);
    const [isDelegated, setIsDelegated] = useState<boolean>(false);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [transactionError, setTransactionError] = useState<string | null>(null);
    const [transactionSuccess, setTransactionSuccess] = useState<string | null>(null);
    const [isPrivate, setIsPrivate] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        const params = new URLSearchParams(window.location.search);
        return params.get('mode') === 'private';
    });
    const [isInitializingEr, setIsInitializingEr] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const counterProgramClient = useRef<Program | null>(null);
    const counterSubscriptionId = useRef<number | null>(null);
    const ephemeralCounterSubscriptionId = useRef<number | null>(null);
    // Cache TEE auth tokens per wallet pubkey so toggling between modes doesn't re-prompt
    const cachedAuthToken = useRef<{ pubkey: string; token: string } | null>(null);

    const COUNTER_PROGRAM = useMemo(
        () => isPrivate ? PRIVATE_COUNTER_PROGRAM : PUBLIC_COUNTER_PROGRAM,
        [isPrivate]
    );
    const counterPda = useMemo(() => {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from(COUNTER_PDA_SEED)],
            COUNTER_PROGRAM
        );
        return pda;
    }, [COUNTER_PROGRAM]);

    // Helpers to dynamically fetch the IDL and initialize the program client
    const getProgramClient = useCallback(async (program: PublicKey): Promise<Program> => {
        const idl = await Program.fetchIdl(program, provider.current);
        if (!idl) throw new Error('IDL not found');
        return new Program(idl, provider.current);
    }, []);

    // Define callbacks function to handle account changes
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

    // Subscribe to the base layer counter
    const subscribeToCounter = useCallback(async (): Promise<void> => {
        if (counterSubscriptionId.current !== null) {
            try { await connection.removeAccountChangeListener(counterSubscriptionId.current); } catch {}
        }
        console.log("Subscribing to counter", counterPda.toBase58());
        counterSubscriptionId.current = connection.onAccountChange(counterPda, handleCounterChange, 'processed');
    }, [connection, counterPda, handleCounterChange]);

    // Subscribe to the ephemeral counter
    const subscribeToEphemeralCounter = useCallback(async (): Promise<void> => {
        if (!ephemeralConnection.current) return;
        if (ephemeralCounterSubscriptionId.current !== null) {
            try { await ephemeralConnection.current.removeAccountChangeListener(ephemeralCounterSubscriptionId.current); } catch {}
        }
        console.log("Subscribing to ephemeral counter", counterPda.toBase58());
        ephemeralCounterSubscriptionId.current = ephemeralConnection.current.onAccountChange(counterPda, handleEphemeralCounterChange, 'confirmed');
    }, [counterPda, handleEphemeralCounterChange]);

    // Reset state and tear down connections when toggling between public and private mode
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        if (isPrivate) {
            params.set('mode', 'private');
        } else {
            params.delete('mode');
        }
        const search = params.toString();
        const newUrl = `${window.location.pathname}${search ? '?' + search : ''}${window.location.hash}`;
        window.history.replaceState(null, '', newUrl);
    }, [isPrivate]);

    // Reset state and tear down connections when toggling between public and private mode
    useEffect(() => {
        return () => {
            if (counterSubscriptionId.current !== null) {
                connection.removeAccountChangeListener(counterSubscriptionId.current).catch(() => {});
                counterSubscriptionId.current = null;
            }
            if (ephemeralCounterSubscriptionId.current !== null && ephemeralConnection.current) {
                ephemeralConnection.current.removeAccountChangeListener(ephemeralCounterSubscriptionId.current).catch(() => {});
                ephemeralCounterSubscriptionId.current = null;
            }
            ephemeralConnection.current = null;
            counterProgramClient.current = null;
            setCounter(0);
            setEphemeralCounter(0);
            setIsDelegated(false);
            setIsLoading(true);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPrivate]);

    // Init program client + base layer counter, then ER connection (with TEE auth in private mode)
    useEffect(() => {
        let cancelled = false;
        const init = async () => {
            // 1. Program client + base layer counter
            if (!counterProgramClient.current) {
                const client = await getProgramClient(COUNTER_PROGRAM);
                if (cancelled) return;
                counterProgramClient.current = client;
                const accountInfo = await provider.current.connection.getAccountInfo(counterPda);
                if (cancelled) return;
                if (accountInfo) {
                    // @ts-ignore
                    const c = await client.account.counter.fetch(counterPda);
                    setCounter(Number(c.count.valueOf()));
                    setIsDelegated(!accountInfo.owner.equals(COUNTER_PROGRAM));
                    await subscribeToCounter();
                }
                setIsLoading(false);
            }

            // 2. ER connection (skip if already initialized or program client missing)
            if (ephemeralConnection.current || !counterProgramClient.current) return;

            let cluster: string;
            let wsEndpoint: string | undefined;

            if (isPrivate) {
                // Private mode requires a wallet that can sign messages so we can fetch a TEE auth token
                if (!publicKey || !signMessage) return;
                setIsInitializingEr(true);
                try {
                    let token: string;
                    const cached = cachedAuthToken.current;
                    if (cached && cached.pubkey === publicKey.toBase58()) {
                        token = cached.token;
                    } else {
                        const result = await getAuthToken(TEE_ENDPOINT, publicKey, signMessage);
                        if (cancelled) return;
                        token = result.token;
                        cachedAuthToken.current = { pubkey: publicKey.toBase58(), token };
                    }
                    cluster = `${TEE_ENDPOINT}?token=${token}`;
                    wsEndpoint = `${TEE_WS_ENDPOINT}?token=${token}`;
                } catch (err) {
                    console.error("Failed to fetch TEE auth token:", err);
                    setTransactionError(`TEE auth failed: ${err}`);
                    setIsInitializingEr(false);
                    return;
                }
                setIsInitializingEr(false);
            } else {
                cluster = PUBLIC_ER_ENDPOINT;
            }

            ephemeralConnection.current = new Connection(
                cluster,
                wsEndpoint
                    ? { wsEndpoint, commitment: "confirmed" }
                    : { commitment: "confirmed" }
            );

            // Airdrop to trigger lazy account reload in the ER
            try {
                await ephemeralConnection.current.requestAirdrop(counterPda, 1);
            } catch {
                console.log("Refreshed account in the ephemeral");
            }

            const erAccountInfo = await ephemeralConnection.current.getAccountInfo(counterPda);
            if (cancelled) return;
            if (erAccountInfo && counterProgramClient.current) {
                const c = counterProgramClient.current.coder.accounts.decode("counter", erAccountInfo.data);
                setEphemeralCounter(Number(c.count.valueOf()));
            }
            await subscribeToEphemeralCounter();
        };
        init().catch(console.error);
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPrivate, publicKey, COUNTER_PROGRAM, counterPda, signMessage]);

    // Detect when publicKey is set/connected and derive a temp keypair
    useEffect(() => {
        if (!publicKey) return;
        if (Keypair.fromSeed(publicKey.toBytes()).publicKey.equals(tempKeypair.current?.publicKey || PublicKey.default)) return;
        console.log("Wallet connected with publicKey:", publicKey.toBase58());
        const newTempKeypair = Keypair.fromSeed(publicKey.toBytes());
        tempKeypair.current = newTempKeypair;
        console.log("Temp Keypair", newTempKeypair.publicKey.toBase58());
    }, [connection, publicKey]);

    /**
     * Top up the temp keypair if it's running low
     */
    const transferToTempKeypair = useCallback(async () => {
        if (!publicKey || !tempKeypair.current) return;
        console.log("Topup wallets");
        await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
        await connection.requestAirdrop(tempKeypair.current.publicKey, LAMPORTS_PER_SOL);
    }, [publicKey, connection]);

    useEffect(() => {
        const checkAndTransfer = async () => {
            if (tempKeypair.current) {
                const accountTmpWallet = await connection.getAccountInfo(tempKeypair.current.publicKey);
                if (!accountTmpWallet || accountTmpWallet.lamports <= 0.01 * LAMPORTS_PER_SOL) {
                    await transferToTempKeypair();
                }
            }
        };
        checkAndTransfer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDelegated, connection]);

    const submitTransaction = useCallback(async (
        transaction: Transaction,
        useTempKeypair: boolean = false,
        ephemeral: boolean = false,
        confirmCommitment: Commitment = "processed"
    ): Promise<string | null> => {
        if (!tempKeypair.current) return null;
        if (!publicKey) return null;
        if (!ephemeralConnection.current) return null;
        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        const targetConnection = ephemeral ? ephemeralConnection.current : provider.current.connection;
        try {
            const {
                context: { slot: minContextSlot },
                value: { blockhash, lastValidBlockHeight }
            } = await targetConnection.getLatestBlockhashAndContext();
            console.log("Submitting transaction...");
            if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
            if (!transaction.feePayer) {
                transaction.feePayer = useTempKeypair ? tempKeypair.current.publicKey : publicKey;
            }
            if (useTempKeypair) transaction.sign(tempKeypair.current);
            let signature;
            if (!ephemeral && !useTempKeypair) {
                signature = await sendTransaction(transaction, targetConnection, { minContextSlot });
            } else {
                signature = await targetConnection.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
            }
            await targetConnection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, confirmCommitment);
            console.log(`Transaction confirmed: ${signature}`);
            setTransactionSuccess(`Transaction confirmed`);
            return signature;
        } catch (error) {
            setTransactionError(`Transaction failed: ${error}`);
        } finally {
            setIsSubmitting(false);
        }
        return null;
    }, [publicKey, sendTransaction]);

    /**
     * Increment the counter (works for both public and private programs — same instruction shape)
     */
    const increaseCounterTx = useCallback(async () => {
        if (!tempKeypair.current) return;
        if (!isDelegated) {
            const accountTmpWallet = await connection.getAccountInfo(tempKeypair.current.publicKey);
            if (!accountTmpWallet || accountTmpWallet.lamports <= 0.01 * LAMPORTS_PER_SOL) {
                await transferToTempKeypair();
            }
        }

        const transaction = await counterProgramClient.current?.methods
            .increment()
            .accounts({
                counter: counterPda,
            }).transaction() as Transaction;

        // Add a noop to make the transaction unique
        const noopInstruction = new TransactionInstruction({
            programId: new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'),
            keys: [],
            data: Buffer.from(crypto.getRandomValues(new Uint8Array(5))),
        });
        transaction.add(noopInstruction);

        await submitTransaction(transaction, true, isDelegated);
    }, [isDelegated, counterPda, submitTransaction, connection, transferToTempKeypair]);

    const updateCounter = async (_: number): Promise<void> => {
        await increaseCounterTx();
    };

    /**
     * Delegate PDA — branches on private vs public account schema
     */
    const delegatePdaTx = useCallback(async () => {
        console.log(`Delegate ${isPrivate ? 'private' : 'public'} counter`);
        if (!tempKeypair.current || !counterProgramClient.current) return;

        const accountTmpWallet = await connection.getAccountInfo(tempKeypair.current.publicKey);
        if (!accountTmpWallet || accountTmpWallet.lamports <= 0.01 * LAMPORTS_PER_SOL) {
            await transferToTempKeypair();
        }

        let transaction: Transaction;
        if (isPrivate) {
            // Private counter: pin the TEE validator. Pass `null` for members = open access.
            transaction = await counterProgramClient.current.methods
                .delegate(null)
                .accounts({
                    payer: tempKeypair.current.publicKey,
                    validator: TEE_VALIDATOR,
                })
                .transaction() as Transaction;
        } else {
            // Public counter: optionally pin a local validator on localnet
            const remainingAccounts =
                connection.rpcEndpoint.includes("localhost") ||
                connection.rpcEndpoint.includes("127.0.0.1")
                    ? [
                        {
                            pubkey: new PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
                            isSigner: false,
                            isWritable: false,
                        },
                    ]
                    : [];
            transaction = await counterProgramClient.current.methods
                .delegate()
                .accounts({
                    payer: tempKeypair.current.publicKey,
                    pda: counterPda,
                })
                .remainingAccounts(remainingAccounts)
                .transaction() as Transaction;
        }

        setEphemeralCounter(Number(counter));
        await submitTransaction(transaction, true, false, "confirmed");
    }, [isPrivate, counterPda, connection, counter, submitTransaction, transferToTempKeypair]);

    /**
     * Undelegate PDA
     *
     * For the private counter, the program's `undelegate` instruction now
     * releases BOTH the permission account and the counter atomically in one
     * ER transaction, so the client just fires a single call in either mode.
     */
    const undelegatePdaTx = useCallback(async () => {
        if (!tempKeypair.current || !counterProgramClient.current) return;
        console.log(`Undelegate ${isPrivate ? 'private' : 'public'} counter`);

        const transaction = await counterProgramClient.current.methods
            .undelegate()
            .accounts({
                payer: tempKeypair.current.publicKey,
                counter: counterPda,
            })
            .transaction() as Transaction;

        await submitTransaction(transaction, true, true);
    }, [isPrivate, counterPda, submitTransaction]);

    const delegateTx = useCallback(async () => {
        await delegatePdaTx();
    }, [delegatePdaTx]);

    const undelegateTx = useCallback(async () => {
        await undelegatePdaTx();
    }, [undelegatePdaTx]);

    const handleSetPrivate = (next: boolean) => {
        if (next === isPrivate) return;
        if (next && (!publicKey || !signMessage)) {
            setTransactionError("Connect a wallet that supports message signing to enable private mode");
            return;
        }
        setIsPrivate(next);
    };

    return (
        <div className="counter-ui">
            <div className="wallet-buttons">
                <WalletMultiButton/>
            </div>

            <h1>Ephemeral Counter</h1>

            <div className="mode-toggle">
                <button
                    className={!isPrivate ? 'active' : ''}
                    onClick={() => handleSetPrivate(false)}
                    disabled={isInitializingEr}
                >
                    Public
                </button>
                <button
                    className={isPrivate ? 'active' : ''}
                    onClick={() => handleSetPrivate(true)}
                    disabled={!publicKey || !signMessage || isInitializingEr}
                    title={!publicKey ? 'Connect wallet to enable private mode' : undefined}
                >
                    Private
                </button>
            </div>

            <div className="button-container">
                <Button title={"Delegate"} resetGame={delegateTx} disabled={isDelegated}/>
                <Button title={"Undelegate"} resetGame={undelegateTx} disabled={!isDelegated}/>
            </div>

            <div className="game">
                <Square
                    key="0"
                    ind={Number(0)}
                    updateSquares={(index: string | number) => updateCounter(Number(index))}
                    clsName={isDelegated ? '' : counter.toString()}
                    loading={isLoading}
                />
                <Square
                    key="1"
                    ind={Number(1)}
                    updateSquares={(index: string | number) => updateCounter(Number(index))}
                    clsName={isDelegated && !isPrivate ? ephemeralCounter.toString() : ''}
                    placeholder={isDelegated && isPrivate ? (
                        <>
                            <div className="placeholder-label">Hidden</div>
                            <div className="placeholder-hint">click to count</div>
                        </>
                    ) : undefined}
                    loading={isLoading}
                />
            </div>

            {(isSubmitting || isInitializingEr) && (
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
                <Alert type="error" message={transactionError} onClose={() => setTransactionError(null)}/>}

            {transactionSuccess &&
                <Alert type="success" message={transactionSuccess} onClose={() => setTransactionSuccess(null)}/>}

            <img src={`${process.env.PUBLIC_URL}/magicblock_white.png`} alt="Magic Block Logo"
                 className="magicblock-logo"/>
        </div>
    );
};

export default App;
