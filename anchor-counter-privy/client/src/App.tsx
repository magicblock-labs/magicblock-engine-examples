import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import Button from "./components/Button";
import Square from "./components/Square";
import {useConnection} from '@solana/wallet-adapter-react';
import Alert from "./components/Alert";
import FundWalletBanner from "./components/FundWalletBanner";
import PrivyConnectButton from "./components/PrivyConnectButton";
import {Program, Provider} from "@coral-xyz/anchor";
import {SimpleProvider} from "./components/Wallet";
import {
    AccountInfo,
    Commitment,
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    Transaction,
    TransactionInstruction
} from "@solana/web3.js";
import {getAuthToken} from "@magicblock-labs/ephemeral-rollups-sdk";
import {usePrivy} from '@privy-io/react-auth';
import {useWallets, useCreateWallet, PrivyStandardWallet} from '@privy-io/react-auth/solana';

const COUNTER_PDA_SEED = "counter";
const PUBLIC_COUNTER_PROGRAM = new PublicKey("9RPwaXayVZHna1BYuRS4cLPJZuNGU1uS5V3heXB7v6Qi");
const PRIVATE_COUNTER_PROGRAM = new PublicKey("91L33vBqfNaNfieqNCoqpxGZ2xVyJ29N3VcErR6LoepZ");
const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
const PUBLIC_ER_ENDPOINT = process.env.REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app";
const TEE_ENDPOINT = (process.env.REACT_APP_TEE_PROVIDER_ENDPOINT || "https://devnet-tee.magicblock.app").replace(/\/$/, "");
const TEE_WS_ENDPOINT = TEE_ENDPOINT.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
const MIN_BALANCE_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;

const App: React.FC = () => {
    const {connection} = useConnection();
    const ephemeralConnection = useRef<Connection | null>(null);
    const provider = useRef<Provider>(new SimpleProvider(connection));

    // Privy — the only auth + signing layer
    const {ready: privyReady, authenticated} = usePrivy();
    const {wallets: solanaWallets} = useWallets();
    const {createWallet} = useCreateWallet();

    const privyWallet = useMemo(
        () => solanaWallets.find(w => (w.standardWallet as PrivyStandardWallet).isPrivyWallet) ?? null,
        [solanaWallets]
    );
    const [privyWalletBalance, setPrivyWalletBalance] = useState<number | null>(null);
    const needsFunding = privyWalletBalance !== null && privyWalletBalance < MIN_BALANCE_LAMPORTS;

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
    const cachedAuthToken = useRef<{ pubkey: string; token: string } | null>(null);
    // One-shot guard — createWallet() has an unstable reference so we never put
    // it in a deps array; the ref ensures it's called at most once.
    const createWalletCalled = useRef(false);

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

    const getProgramClient = useCallback(async (program: PublicKey): Promise<Program> => {
        const idl = await Program.fetchIdl(program, provider.current);
        if (!idl) throw new Error('IDL not found');
        return new Program(idl, provider.current);
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
        if (counterSubscriptionId.current !== null) {
            try { await connection.removeAccountChangeListener(counterSubscriptionId.current); } catch {}
        }
        counterSubscriptionId.current = connection.onAccountChange(counterPda, handleCounterChange, 'processed');
    }, [connection, counterPda, handleCounterChange]);

    const subscribeToEphemeralCounter = useCallback(async (): Promise<void> => {
        if (!ephemeralConnection.current) return;
        if (ephemeralCounterSubscriptionId.current !== null) {
            try { await ephemeralConnection.current.removeAccountChangeListener(ephemeralCounterSubscriptionId.current); } catch {}
        }
        ephemeralCounterSubscriptionId.current = ephemeralConnection.current.onAccountChange(counterPda, handleEphemeralCounterChange, 'confirmed');
    }, [counterPda, handleEphemeralCounterChange]);

    // Sync URL query param with isPrivate state
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        if (isPrivate) { params.set('mode', 'private'); } else { params.delete('mode'); }
        const search = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${search ? '?' + search : ''}${window.location.hash}`);
    }, [isPrivate]);

    // Tear down subscriptions and reset state when mode toggles
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

    // Init program client + base layer counter, then ER connection.
    // privyWallet drives both — TEE auth uses the embedded wallet's signMessage.
    useEffect(() => {
        let cancelled = false;
        const init = async () => {
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

            if (ephemeralConnection.current || !counterProgramClient.current) return;

            let cluster: string;
            let wsEndpoint: string | undefined;

            if (isPrivate) {
                if (!privyWallet) return;
                setIsInitializingEr(true);
                try {
                    let token: string;
                    const walletAddr = privyWallet.address;
                    const cached = cachedAuthToken.current;
                    if (cached && cached.pubkey === walletAddr) {
                        token = cached.token;
                    } else {
                        const walletPubkey = new PublicKey(walletAddr);
                        const signMsg = async (msg: Uint8Array) => {
                            const {signature} = await privyWallet.signMessage({message: msg});
                            return signature;
                        };
                        const result = await getAuthToken(TEE_ENDPOINT, walletPubkey, signMsg);
                        if (cancelled) return;
                        token = result.token;
                        cachedAuthToken.current = {pubkey: walletAddr, token};
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
                wsEndpoint ? {wsEndpoint, commitment: "confirmed"} : {commitment: "confirmed"}
            );

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
    }, [isPrivate, privyWallet, COUNTER_PROGRAM, counterPda]);

    // Create the embedded Solana wallet once after Privy authentication.
    // createWallet is excluded from deps — it has an unstable reference.
    useEffect(() => {
        if (!authenticated || !privyReady || privyWallet || createWalletCalled.current) return;
        createWalletCalled.current = true;
        createWallet().catch(console.error);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authenticated, privyReady, privyWallet]);

    // Poll the embedded wallet balance
    const refreshPrivyBalance = useCallback(async () => {
        if (!privyWallet) return;
        const lamports = await connection.getBalance(new PublicKey(privyWallet.address));
        setPrivyWalletBalance(lamports);
    }, [privyWallet, connection]);

    useEffect(() => {
        if (!privyWallet) return;
        refreshPrivyBalance();
        const id = setInterval(refreshPrivyBalance, 5000);
        return () => clearInterval(id);
    }, [privyWallet, refreshPrivyBalance]);

    const submitTransaction = useCallback(async (
        transaction: Transaction,
        ephemeral: boolean = false,
        confirmCommitment: Commitment = "processed"
    ): Promise<string | null> => {
        if (!privyWallet) return null;
        if (!ephemeralConnection.current) return null;
        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        const targetConnection = ephemeral ? ephemeralConnection.current : provider.current.connection;
        try {
            const {value: {blockhash, lastValidBlockHeight}} = await targetConnection.getLatestBlockhashAndContext();
            const privyPublicKey = new PublicKey(privyWallet.address);
            if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
            if (!transaction.feePayer) transaction.feePayer = privyPublicKey;
            const txBytes = new Uint8Array(transaction.serialize({requireAllSignatures: false}));
            const {signedTransaction} = await privyWallet.signTransaction({transaction: txBytes});
            const signature = await targetConnection.sendRawTransaction(signedTransaction, {skipPreflight: true});
            await targetConnection.confirmTransaction({blockhash, lastValidBlockHeight, signature}, confirmCommitment);
            console.log(`Transaction confirmed: ${signature}`);
            setTransactionSuccess(`Confirmed: ${signature.slice(0, 8)}…${signature.slice(-8)}`);
            refreshPrivyBalance();
            return signature;
        } catch (error) {
            setTransactionError(`Transaction failed: ${error}`);
        } finally {
            setIsSubmitting(false);
        }
        return null;
    }, [privyWallet, refreshPrivyBalance]);

    const increaseCounterTx = useCallback(async () => {
        if (!privyWallet || needsFunding) return;
        const transaction = await counterProgramClient.current?.methods
            .increment()
            .accounts({counter: counterPda})
            .transaction() as Transaction;
        transaction.add(new TransactionInstruction({
            programId: new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'),
            keys: [],
            data: Buffer.from(crypto.getRandomValues(new Uint8Array(5))),
        }));
        await submitTransaction(transaction, isDelegated);
    }, [isDelegated, counterPda, submitTransaction, privyWallet, needsFunding]);

    const updateCounter = async (_: number): Promise<void> => { await increaseCounterTx(); };

    const delegatePdaTx = useCallback(async () => {
        if (!privyWallet || !counterProgramClient.current || needsFunding) return;
        const privyPublicKey = new PublicKey(privyWallet.address);
        let transaction: Transaction;
        if (isPrivate) {
            transaction = await counterProgramClient.current.methods
                .delegate(null)
                .accounts({payer: privyPublicKey, validator: TEE_VALIDATOR})
                .transaction() as Transaction;
        } else {
            const remainingAccounts =
                connection.rpcEndpoint.includes("localhost") || connection.rpcEndpoint.includes("127.0.0.1")
                    ? [{pubkey: new PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"), isSigner: false, isWritable: false}]
                    : [];
            transaction = await counterProgramClient.current.methods
                .delegate()
                .accounts({payer: privyPublicKey, pda: counterPda})
                .remainingAccounts(remainingAccounts)
                .transaction() as Transaction;
        }
        setEphemeralCounter(Number(counter));
        await submitTransaction(transaction, false, "confirmed");
    }, [isPrivate, counterPda, connection, counter, submitTransaction, privyWallet, needsFunding]);

    const undelegatePdaTx = useCallback(async () => {
        if (!privyWallet || !counterProgramClient.current) return;
        const transaction = await counterProgramClient.current.methods
            .undelegate()
            .accounts({payer: new PublicKey(privyWallet.address), counter: counterPda})
            .transaction() as Transaction;
        await submitTransaction(transaction, true);
    }, [isPrivate, counterPda, submitTransaction, privyWallet]);

    const delegateTx = useCallback(async () => { await delegatePdaTx(); }, [delegatePdaTx]);
    const undelegateTx = useCallback(async () => { await undelegatePdaTx(); }, [undelegatePdaTx]);

    const handleSetPrivate = (next: boolean) => {
        if (next === isPrivate) return;
        if (next && !privyWallet) {
            setTransactionError("Connect a wallet to enable private mode");
            return;
        }
        setIsPrivate(next);
    };

    const actionsDisabled = isSubmitting || needsFunding || !privyWallet;

    return (
        <div className="counter-ui">
            <div className="wallet-buttons">
                <PrivyConnectButton
                    address={privyWallet?.address}
                    balanceLamports={privyWalletBalance}
                />
            </div>

            {privyWallet && needsFunding && privyWalletBalance !== null && (
                <FundWalletBanner
                    address={privyWallet.address}
                    balanceLamports={privyWalletBalance}
                    onRefresh={refreshPrivyBalance}
                />
            )}

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
                    disabled={!privyWallet || isInitializingEr}
                    title={!privyWallet ? 'Connect wallet to enable private mode' : undefined}
                >
                    Private
                </button>
            </div>

            <div className="button-container">
                <Button title={"Delegate"} resetGame={delegateTx} disabled={isDelegated || actionsDisabled}/>
                <Button title={"Undelegate"} resetGame={undelegateTx} disabled={!isDelegated || actionsDisabled}/>
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
                <div style={{display: 'flex', justifyContent: 'center', alignItems: 'flex-end', position: 'fixed', bottom: '20px', left: 0, width: '100%', zIndex: 1000}}>
                    <div className="spinner"></div>
                </div>
            )}

            {transactionError && <Alert type="error" message={transactionError} onClose={() => setTransactionError(null)}/>}
            {transactionSuccess && <Alert type="success" message={transactionSuccess} onClose={() => setTransactionSuccess(null)}/>}

            <img src={`${process.env.PUBLIC_URL}/magicblock_white.png`} alt="Magic Block Logo" className="magicblock-logo"/>
        </div>
    );
};

export default App;
