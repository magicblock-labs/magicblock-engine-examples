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
    TransactionInstruction
} from "@solana/web3.js";
// IDL is copied into src/idl/ by the `copy-idl` npm script (runs as prebuild/prestart).
import publicCounterIdl from "./idl/public_counter.json";

const COUNTER_PDA_SEED = "counter";
// Program ID comes from the local IDL so it stays in sync with declare_id! after redeploys.
const COUNTER_PROGRAM = new PublicKey(publicCounterIdl.address);
console.log("Counter program:", COUNTER_PROGRAM.toBase58());
// Default to a specific ER region (devnet-as) instead of the router (devnet.magicblock.app).
// The router proxies HTTP per-request but a WS subscription is bound to whichever ER it
// happened to pick at connect time — txs routed elsewhere wouldn't fire the WS callback,
// so the UI would stall. Override via REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT for other regions.
const PUBLIC_ER_ENDPOINT = process.env.REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app";

const App: React.FC = () => {
    const { connection } = useConnection();
    const ephemeralConnection = useRef<Connection | null>(null);
    const provider = useRef<Provider>(new SimpleProvider(connection));
    const { publicKey, sendTransaction } = useWallet();
    const tempKeypair = useRef<Keypair | null>(null);
    const [counter, setCounter] = useState<number>(0);
    const [ephemeralCounter, setEphemeralCounter] = useState<number>(0);
    const [isDelegated, setIsDelegated] = useState<boolean>(false);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [transactionError, setTransactionError] = useState<string | null>(null);
    const [transactionSuccess, setTransactionSuccess] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const counterProgramClient = useRef<Program | null>(null);
    const counterSubscriptionId = useRef<number | null>(null);
    const ephemeralCounterSubscriptionId = useRef<number | null>(null);

    const counterPda = useMemo(() => {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from(COUNTER_PDA_SEED)],
            COUNTER_PROGRAM
        );
        return pda;
    }, []);

    // Build the program client from the LOCAL IDL (copied into src/idl/ by the copy-idl
    // npm script). Avoids Program.fetchIdl, which can return an on-chain IDL whose
    // `address` field is stale and silently makes the client subscribe to the wrong PDA.
    const getProgramClient = useCallback(async (): Promise<Program> => {
        return new Program(publicCounterIdl as Idl, provider.current);
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
        // Use 'processed' — ER doesn't reliably emit 'confirmed' WS notifications,
        // and 'processed' fires at slot-time which is what we want for UI latency.
        ephemeralCounterSubscriptionId.current = ephemeralConnection.current.onAccountChange(counterPda, handleEphemeralCounterChange, 'processed');
    }, [counterPda, handleEphemeralCounterChange]);

    // Init program client + base layer counter, then ER connection
    useEffect(() => {
        let cancelled = false;
        const init = async () => {
            // 1. Program client + base layer counter
            if (!counterProgramClient.current) {
                const client = await getProgramClient();
                if (cancelled) return;
                counterProgramClient.current = client;
                const accountInfo = await provider.current.connection.getAccountInfo(counterPda);
                if (cancelled) return;
                if (accountInfo) {
                    // @ts-ignore
                    const c = await client.account.counter.fetch(counterPda);
                    setCounter(Number(c.count.valueOf()));
                    setIsDelegated(!accountInfo.owner.equals(COUNTER_PROGRAM));
                }
                // Subscribe unconditionally — listener fires when init+increment creates the account.
                await subscribeToCounter();
                setIsLoading(false);
            }

            // 2. ER connection (skip if already initialized or program client missing)
            if (ephemeralConnection.current || !counterProgramClient.current) return;

            ephemeralConnection.current = new Connection(PUBLIC_ER_ENDPOINT, { commitment: "confirmed" });

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
    }, [publicKey, counterPda]);

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
        confirmCommitment: Commitment = "processed",
        // Optional: an account that's expected to change as a result of this tx.
        // If provided, we resolve confirmation via onAccountChange (push, ~slot-time)
        // instead of HTTP polling. Otherwise we fall back to getSignatureStatuses polling.
        watchAccount?: PublicKey,
    ): Promise<string | null> => {
        if (!tempKeypair.current) return null;
        if (!publicKey) return null;
        if (!ephemeralConnection.current) return null;
        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        const targetConnection = ephemeral ? ephemeralConnection.current : provider.current.connection;
        const layerLabel = ephemeral ? "ER" : "Base";
        try {
            const {
                context: { slot: minContextSlot },
                value: { blockhash, lastValidBlockHeight }
            } = await targetConnection.getLatestBlockhashAndContext();
            console.log(`Submitting transaction to ${layerLabel}...`);
            if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
            if (!transaction.feePayer) {
                transaction.feePayer = useTempKeypair ? tempKeypair.current.publicKey : publicKey;
            }
            if (useTempKeypair) transaction.sign(tempKeypair.current);
            let signature;
            const sendStart = performance.now();
            if (!ephemeral && !useTempKeypair) {
                signature = await sendTransaction(transaction, targetConnection, { minContextSlot });
            } else {
                signature = await targetConnection.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
            }
            const sendMs = Math.round(performance.now() - sendStart);

            // Confirm via solana-web3.js's confirmTransaction (signature WS sub at the
            // requested commitment). On ER at 'processed' this resolves at slot-time
            // (~30-100ms). Known wart: ~500ms HTTP polling fallback when the WS sub setup
            // is slow — rare in practice, simpler code wins.
            const confirmStart = performance.now();
            const sigConfirm = await targetConnection.confirmTransaction(
                { signature, blockhash, lastValidBlockHeight },
                confirmCommitment,
            );
            if (sigConfirm.value.err) {
                throw new Error(`Transaction failed on chain: ${JSON.stringify(sigConfirm.value.err)}`);
            }
            const confirmMs = Math.round(performance.now() - confirmStart);

            // Refresh the watched account inline so the UI updates immediately without
            // waiting for the long-lived subscribeToCounter/subscribeToEphemeralCounter
            // handler to fire on its own.
            let refreshMs = 0;
            if (watchAccount && counterProgramClient.current) {
                const refreshStart = performance.now();
                try {
                    const accountInfo = await targetConnection.getAccountInfo(watchAccount);
                    if (accountInfo && watchAccount.equals(counterPda)) {
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
            setTransactionSuccess(`[${layerLabel}] confirmed in ${totalMs}ms`);
            return signature;
        } catch (error) {
            setTransactionError(`Transaction failed: ${error}`);
        } finally {
            setIsSubmitting(false);
        }
        return null;
    }, [publicKey, sendTransaction, counterPda]);

    /**
     * Increment the counter (works for both public and private programs — same instruction shape)
     */
    const increaseCounterTx = useCallback(async () => {
        if (!tempKeypair.current) return;
        if (!counterProgramClient.current) {
            console.error("counterProgramClient not initialized yet");
            return;
        }
        if (!isDelegated) {
            const accountTmpWallet = await connection.getAccountInfo(tempKeypair.current.publicKey);
            if (!accountTmpWallet || accountTmpWallet.lamports <= 0.01 * LAMPORTS_PER_SOL) {
                await transferToTempKeypair();
            }
        }

        const transaction = await counterProgramClient.current.methods
            .increment()
            .accounts({
                counter: counterPda,
            }).transaction() as Transaction;

        // If counter PDA doesn't exist yet, prepend an initialize ix.
        // Must run BEFORE increment, otherwise increment hits AccountNotInitialized (0xbc4).
        // Use tempKeypair as user/payer so the tx only needs the tempKeypair signature
        // (matches how submitTransaction signs when useTempKeypair=true). The counter
        // PDA seed is just [COUNTER_SEED] — global, not per-user — so any signer works.
        // Skip when delegated — counter is on the ER then, not the base layer.
        if (!isDelegated) {
            const accountInfo = await connection.getAccountInfo(counterPda);
            if (!accountInfo) {
                console.log("Counter not initialized, prepending initialize instruction");
                const initIx = await counterProgramClient.current.methods
                    .initialize()
                    .accounts({ user: tempKeypair.current.publicKey })
                    .instruction();
                transaction.instructions.unshift(initIx);
            }
        }

        // Add a noop to make the transaction unique
        const noopInstruction = new TransactionInstruction({
            programId: new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'),
            keys: [],
            data: Buffer.from(crypto.getRandomValues(new Uint8Array(5))),
        });
        transaction.add(noopInstruction);

        // Base-layer txs use 'confirmed' (devnet has reorgs at 'processed'); ER uses
        // 'processed' since it's a single sequencer and no slot can orphan.
        const commitment = isDelegated ? "processed" : "confirmed";
        await submitTransaction(transaction, true, isDelegated, commitment, counterPda);
    }, [isDelegated, counterPda, submitTransaction, connection, transferToTempKeypair]);

    const updateCounter = async (_: number): Promise<void> => {
        await increaseCounterTx();
    };

    /**
     * Delegate PDA
     */
    const delegatePdaTx = useCallback(async () => {
        console.log("Delegate public counter");
        if (!tempKeypair.current || !counterProgramClient.current) return;

        const accountTmpWallet = await connection.getAccountInfo(tempKeypair.current.publicKey);
        if (!accountTmpWallet || accountTmpWallet.lamports <= 0.01 * LAMPORTS_PER_SOL) {
            await transferToTempKeypair();
        }

        // Optionally pin a local validator on localnet
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
        const transaction = await counterProgramClient.current.methods
            .delegate()
            .accounts({
                payer: tempKeypair.current.publicKey,
                pda: counterPda,
            })
            .remainingAccounts(remainingAccounts)
            .transaction() as Transaction;

        setEphemeralCounter(Number(counter));
        await submitTransaction(transaction, true, false, "confirmed", counterPda);
    }, [counterPda, connection, counter, submitTransaction, transferToTempKeypair]);

    /**
     * Undelegate PDA
     */
    const undelegatePdaTx = useCallback(async () => {
        if (!tempKeypair.current || !counterProgramClient.current) return;
        console.log("Undelegate public counter");

        const transaction = await counterProgramClient.current.methods
            .undelegate()
            .accounts({
                payer: tempKeypair.current.publicKey,
                counter: counterPda,
            })
            .transaction() as Transaction;

        await submitTransaction(transaction, true, true, "processed", counterPda);
    }, [counterPda, submitTransaction]);

    const delegateTx = useCallback(async () => {
        await delegatePdaTx();
    }, [delegatePdaTx]);

    const undelegateTx = useCallback(async () => {
        await undelegatePdaTx();
    }, [undelegatePdaTx]);

    return (
        <div className="counter-ui">
            <div className="wallet-buttons">
                <WalletMultiButton/>
            </div>

            <h1>Ephemeral Counter</h1>

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
                    clsName={isDelegated ? ephemeralCounter.toString() : ''}
                    loading={isLoading}
                />
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
                <Alert type="error" message={transactionError} onClose={() => setTransactionError(null)}/>}

            {transactionSuccess &&
                <Alert type="success" message={transactionSuccess} onClose={() => setTransactionSuccess(null)}/>}

            <img src={`${process.env.PUBLIC_URL}/magicblock_white.png`} alt="Magic Block Logo"
                 className="magicblock-logo"/>
        </div>
    );
};

export default App;