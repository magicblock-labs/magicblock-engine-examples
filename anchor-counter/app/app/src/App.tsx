import React, {useCallback, useEffect, useRef, useState} from "react";
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
    Transaction, TransactionInstruction
} from "@solana/web3.js";

const COUNTER_PDA_SEED = "test-pda";
const COUNTER_PROGRAM = new PublicKey("9BAQP9pBBFEcVxMJMgmSjBq9AeBELjowMA7twzMcXtXk");

const App: React.FC = () => {
    let { connection } = useConnection();
    const ephemeralConnection  = useRef<Connection | null>(null);
    const provider = useRef<Provider>(new SimpleProvider(connection));
    const { publicKey, sendTransaction } = useWallet();
    const tempKeypair = useRef<Keypair | null>(null);
    const [counter, setCounter] = useState<number>(0);
    const [ephemeralCounter, setEphemeralCounter] = useState<number>(0);
    const [isDelegated, setIsDelegated] = useState<boolean>(false);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [transactionError, setTransactionError] = useState<string | null>(null);
    const [transactionSuccess, setTransactionSuccess] = useState<string | null>(null);
    const counterProgramClient = useRef<Program | null>(null);
    const [counterPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(COUNTER_PDA_SEED)],
        COUNTER_PROGRAM
    );
    let counterSubscriptionId = useRef<number | null>(null);
    let ephemeralCounterSubscriptionId = useRef<number | null>(null);

    // Helpers to Dynamically fetch the IDL and initialize the program client
    const getProgramClient = useCallback(async (program: PublicKey): Promise<Program> => {
        const idl = await Program.fetchIdl(program, provider.current);
        if (!idl) throw new Error('IDL not found');
        return new Program(idl, provider.current);
    }, [provider]);

    // Define callbacks function to handle account changes
    const handleCounterChange = useCallback((accountInfo: AccountInfo<Buffer>) => {
        console.log("Ephemeral counter changed", accountInfo);
        if (!counterProgramClient.current) return;
        const decodedData = counterProgramClient.current.coder.accounts.decode('counter', accountInfo.data);
        setIsDelegated(!accountInfo.owner.equals(counterProgramClient.current.programId));
        setCounter(Number(decodedData.count));
    }, []);

    const handleEphemeralCounterChange = useCallback((accountInfo: AccountInfo<Buffer>) => {
        console.log("Ephemeral counter changed", accountInfo);
        if (!counterProgramClient.current) return;
        const decodedData = counterProgramClient.current.coder.accounts.decode('counter', accountInfo.data);
        setEphemeralCounter(Number(decodedData.count));
    }, []);

    // Subscribe to the counters updates
    const subscribeToCounter = useCallback(async (): Promise<void> => {
        if (counterSubscriptionId && counterSubscriptionId.current) await connection.removeAccountChangeListener(counterSubscriptionId.current);
        console.log("Subscribing to counter", counterPda.toBase58());
        // Subscribe to counter changes
        counterSubscriptionId.current = connection.onAccountChange(counterPda, handleCounterChange, 'processed');
    }, [connection, counterPda, handleCounterChange]);

    // Subscribe to the ephemeral counter updates
    const subscribeToEphemeralCounter = useCallback(async (): Promise<void> => {
        if(!ephemeralConnection.current) return;
        console.log("Subscribing to ephemeral counter", counterPda.toBase58());
        if (ephemeralCounterSubscriptionId && ephemeralCounterSubscriptionId.current) await ephemeralConnection.current.removeAccountChangeListener(ephemeralCounterSubscriptionId.current);
        // Subscribe to ephemeral counter changes
        ephemeralCounterSubscriptionId.current = ephemeralConnection.current.onAccountChange(counterPda, handleEphemeralCounterChange, 'confirmed');
    }, [counterPda, handleEphemeralCounterChange]);

    useEffect(() => {
        const initializeProgramClient = async () => {
            if(counterProgramClient.current) return;
            counterProgramClient.current = await getProgramClient(COUNTER_PROGRAM);
            const accountInfo = await provider.current.connection.getAccountInfo(counterPda);
            if (accountInfo) {
                // @ts-ignore
                const counter = await counterProgramClient.current.account.counter.fetch(counterPda);
                setCounter(Number(counter.count.valueOf()));
                setIsDelegated(!accountInfo.owner.equals(COUNTER_PROGRAM));
                await subscribeToCounter();
            }
        };
        initializeProgramClient().catch(console.error);
    }, [connection, counterPda, getProgramClient, subscribeToCounter]);

    // Detect when publicKey is set/connected
    useEffect( () => {
        if (!publicKey) return;
        if (!publicKey || Keypair.fromSeed(publicKey.toBytes()).publicKey.equals(tempKeypair.current?.publicKey || PublicKey.default)) return;
        console.log("Wallet connected with publicKey:", publicKey.toBase58());
        // Derive the temp keypair from the publicKey
        const newTempKeypair = Keypair.fromSeed(publicKey.toBytes());
        tempKeypair.current = newTempKeypair;
        console.log("Temp Keypair", newTempKeypair.publicKey.toBase58());
    }, [connection, publicKey]);

    useEffect(() => {
        const checkAndTransfer = async () => {
            if (tempKeypair.current) {
                const accountTmpWallet = await connection.getAccountInfo(tempKeypair.current.publicKey);
                if (!accountTmpWallet || accountTmpWallet.lamports <= 0.01 * LAMPORTS_PER_SOL) {
                    await transferToTempKeypair()
                }
            }
        };
        checkAndTransfer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDelegated, connection]);

    useEffect(() => {
        const initializeEphemeralConnection = async () => {
            const cluster = process.env.REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app"
            if(ephemeralConnection.current || counterProgramClient.current == null) {
                return;
            }
            ephemeralConnection.current = new Connection(cluster);
            // Airdrop to trigger lazy reload
            try {
                await ephemeralConnection.current?.requestAirdrop(counterPda, 1);
            }catch (_){
                console.log("Refreshed account in the ephemeral");
            }
            const accountInfo = await ephemeralConnection.current.getAccountInfo(counterPda);
            if (accountInfo) {
                // @ts-ignore
                const counter = await counterProgramClient.current.coder.accounts.decode("counter", accountInfo.data);
                setEphemeralCounter(Number(counter.count.valueOf()));
                await subscribeToCounter();
            }
            await subscribeToEphemeralCounter();
        };
        initializeEphemeralConnection().catch(console.error);
    }, [counterPda, subscribeToCounter, subscribeToEphemeralCounter]);

    const updateCounter = async (_: number): Promise<void> => {
        await increaseCounterTx();
    };


    const submitTransaction = useCallback(async (transaction: Transaction, useTempKeypair: boolean = false, ephemeral: boolean = false, confirmCommitment : Commitment = "processed"): Promise<string | null> => {
        if (!tempKeypair.current) return null;
        if (!publicKey) return null;
        if (!ephemeralConnection.current) return null;
        //if (isSubmitting) return null;
        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        let connection = ephemeral ? ephemeralConnection.current : provider.current.connection;
        try {
            const {
                context: { slot: minContextSlot },
                value: { blockhash, lastValidBlockHeight }
            } = await connection.getLatestBlockhashAndContext();
            console.log("Submitting transaction...");
            if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
            if (!transaction.feePayer) useTempKeypair ? transaction.feePayer = tempKeypair.current.publicKey : transaction.feePayer = publicKey;
            if(useTempKeypair) transaction.sign(tempKeypair.current);
            let signature;
            if(!ephemeral && !useTempKeypair){
                signature = await sendTransaction(transaction, connection, { minContextSlot});
            }else{
                signature = await connection.sendRawTransaction(transaction.serialize(), {skipPreflight: true});
            }
            await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, confirmCommitment);
            // Transaction was successful
            console.log(`Transaction confirmed: ${signature}`);
            setTransactionSuccess(`Transaction confirmed`);
            return signature;
        } catch (error) {
            setTransactionError(`Transaction failed: ${error}`);
        } finally {
            setIsSubmitting(false);
        }
        return null;
    }, [publicKey, sendTransaction, tempKeypair]);

    /**
     * Transfer some SOL to temp keypair
     */
    const transferToTempKeypair = useCallback(async () => {
        if (!publicKey || !tempKeypair.current) return;
        console.log("Topup wallets");
        await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
        await connection.requestAirdrop(tempKeypair.current.publicKey, LAMPORTS_PER_SOL);
        return;
    }, [publicKey, tempKeypair, connection]);

    /**
     * Increase counter transaction
     */
    const increaseCounterTx = useCallback(async () => {
        if (!tempKeypair.current) return;
        if(!isDelegated){
            const accountTmpWallet = await connection.getAccountInfo(tempKeypair.current.publicKey);
            if (!accountTmpWallet || accountTmpWallet.lamports <= 0.01 * LAMPORTS_PER_SOL) {
                await transferToTempKeypair()
            }
        }

        const transaction = await counterProgramClient.current?.methods
            .increment()
            .accounts({
                counter: counterPda,
            }).transaction() as Transaction;

        // Add instruction to print to the noop program and and make the transaction unique
        const noopInstruction = new TransactionInstruction({
            programId: new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'),
            keys: [],
            data: Buffer.from(crypto.getRandomValues(new Uint8Array(5))),
        });
        transaction.add(noopInstruction);

        await submitTransaction(transaction, true, isDelegated);
    }, [isDelegated, counterPda, submitTransaction, connection, transferToTempKeypair]);

    /**
     * Delegate PDA transaction
     */
    const delegatePdaTx = useCallback(async () => {
        console.log("Delegate PDA transaction");
        console.log(tempKeypair.current);
        if (!tempKeypair.current) return;
        const accountTmpWallet = await connection.getAccountInfo(tempKeypair.current.publicKey);
        if (!accountTmpWallet || accountTmpWallet.lamports <= 0.01 * LAMPORTS_PER_SOL) {
            await transferToTempKeypair()
        }
        const remainingAccounts =
            connection.rpcEndpoint.includes("localhost") ||
            connection.rpcEndpoint.includes("127.0.0.1")
                ? [
                    {
                        pubkey: new PublicKey(
                            "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
                        ),
                        isSigner: false,
                        isWritable: false,
                    },
                ]
                : [];
        const transaction = await counterProgramClient.current?.methods
            .delegate()
            .accounts({
                payer: tempKeypair.current.publicKey,
                pda: counterPda
            })
            .remainingAccounts(remainingAccounts)
            .transaction() as Transaction;
        setEphemeralCounter(Number(counter));
        await submitTransaction(transaction, true, false, "confirmed");
    }, [counterPda, connection, counter, submitTransaction, transferToTempKeypair]);

    /**
     * Undelegate PDA transaction
     */
    const undelegatePdaTx = useCallback(async () => {
        if (!tempKeypair.current) return;
        console.log("Undelegate PDA transaction");
        const transaction = await counterProgramClient.current?.methods
            .undelegate()
            .accounts({
                payer: tempKeypair.current.publicKey,
                counter: counterPda,
            })
            .transaction() as Transaction;

        await submitTransaction(transaction, true, true);
    }, [tempKeypair, counterPda, submitTransaction]);

    /**
     * -------
     */

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
                />
                <Square
                    key="1"
                    ind={Number(1)}
                    updateSquares={(index: string | number) => updateCounter(Number(index))}
                    clsName={isDelegated ? ephemeralCounter.toString() : ''}
                />
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