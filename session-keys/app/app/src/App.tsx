import React, {useCallback, useEffect, useRef, useState} from "react";
import Button from "./components/Button";
import Square from "./components/Square";
import {useConnection, useWallet} from '@solana/wallet-adapter-react';
import {WalletMultiButton} from "@solana/wallet-adapter-react-ui";
import Alert from "./components/Alert";
import * as anchor from "@coral-xyz/anchor";
import {Program, Provider} from "@coral-xyz/anchor";
import {SimpleProvider} from "./components/Wallet";
import {
    AccountInfo,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    Transaction, TransactionInstruction
} from "@solana/web3.js";

import { SessionTokenManager } from "@magicblock-labs/gum-sdk";

const COUNTER_PDA_SEED = "counter";
const COUNTER_PROGRAM = new PublicKey("6nMudTUrvXh1NGDyJYHPozJRmmHxB3s9Mjp2pSQqZiZ9");

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
    const [counterPda, setCounterPda] = useState<PublicKey | null>(null);
    let counterSubscriptionId = useRef<number | null>(null);
    let ephemeralCounterSubscriptionId = useRef<number | null>(null);
    const sessionTokenManager = useRef<SessionTokenManager | null>(null);
    const sessionTokenPDA = useRef<PublicKey | null>(null);
    const SESSION_TOKEN_SEED = "session_token";

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
        if (!counterPda) return;
        if (counterSubscriptionId && counterSubscriptionId.current) await connection.removeAccountChangeListener(counterSubscriptionId.current);
        console.log("Subscribing to counter", counterPda.toBase58());
        // Subscribe to counter changes
        counterSubscriptionId.current = connection.onAccountChange(counterPda, handleCounterChange, 'processed');
    }, [connection, counterPda, handleCounterChange]);

    // Subscribe to the ephemeral counter updates
    const subscribeToEphemeralCounter = useCallback(async (): Promise<void> => {
        if(!ephemeralConnection.current) return;
        if (!counterPda) return;
        console.log("Subscribing to ephemeral counter", counterPda.toBase58());
        if (ephemeralCounterSubscriptionId && ephemeralCounterSubscriptionId.current) await ephemeralConnection.current.removeAccountChangeListener(ephemeralCounterSubscriptionId.current);
        // Subscribe to ephemeral counter changes
        ephemeralCounterSubscriptionId.current = ephemeralConnection.current.onAccountChange(counterPda, handleEphemeralCounterChange, 'confirmed');
    }, [counterPda, handleEphemeralCounterChange]);

    useEffect(() => {
        const initializeProgramClient = async () => {
            if(counterProgramClient.current) return;
            if (!counterPda) return;
            counterProgramClient.current = await getProgramClient(COUNTER_PROGRAM);
            const accountInfo = await provider.current.connection.getAccountInfo(counterPda);
            if (accountInfo) {
                // @ts-ignore
                const counter = await counterProgramClient.current.account.counter.fetch(counterPda);
                const counterValue = typeof counter.count.toNumber === 'function' ? counter.count.toNumber() : Number(counter.count);
                setCounter(counterValue);
                const isDelegatedNow = !accountInfo.owner.equals(COUNTER_PROGRAM);
                setIsDelegated(isDelegatedNow);
                
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

    // Derive counterPda with publicKey included in seed
    useEffect(() => {
        if (!publicKey) return;
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from(COUNTER_PDA_SEED), publicKey.toBuffer()],
            COUNTER_PROGRAM
        );
        setCounterPda(pda);
    }, [publicKey]);

    // Initialize session manager
    useEffect(() => {
        if (!publicKey || !tempKeypair.current || !counterProgramClient.current) return;
        
        const initSessionManager = async () => {
            sessionTokenManager.current = new SessionTokenManager(provider.current as any, connection);
            const [pda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from(SESSION_TOKEN_SEED),
                    COUNTER_PROGRAM.toBytes(),
                    tempKeypair.current!.publicKey.toBytes(),
                    publicKey.toBuffer(),
                ],
                sessionTokenManager.current.program.programId
            );
            sessionTokenPDA.current = pda;
            console.log("Session Token PDA:", pda.toString());
        };
        
        initSessionManager().catch(console.error);
    }, [publicKey, connection]);

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
            if(ephemeralConnection.current || counterProgramClient.current == null || !counterPda) {
                return;
            }
            ephemeralConnection.current = new Connection(cluster);
            
            // Retry logic to wait for account to sync to ephemeral rollups
            let retries = 0;
            const maxRetries = 10;
            let accountInfo = null;
            
            while (retries < maxRetries && !accountInfo) {
                try {
                    // Airdrop to trigger lazy reload
                    await ephemeralConnection.current?.requestAirdrop(counterPda, 1);
                } catch (_) {
                    console.log("Account already exists in ephemeral");
                }
                
                accountInfo = await ephemeralConnection.current.getAccountInfo(counterPda);
                if (accountInfo) {
                    // @ts-ignore
                    const counter = await counterProgramClient.current.coder.accounts.decode("counter", accountInfo.data);
                    const ephemeralValue = typeof counter.count.toNumber === 'function' ? counter.count.toNumber() : Number(counter.count);
                    setEphemeralCounter(ephemeralValue);
                    await subscribeToCounter();
                    break;
                }
                
                retries++;
                if (retries < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                }
            
            await subscribeToEphemeralCounter();
        };
        initializeEphemeralConnection().catch(console.error);
        }, [counterPda, isDelegated, subscribeToCounter, subscribeToEphemeralCounter]);

    const updateCounter = async (_: number): Promise<void> => {
        await increaseCounterTx();
    };




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
        if (!tempKeypair.current) {
            console.error("tempKeypair not available");
            return;
        }
        if (!counterPda) {
            console.error("counterPda not available");
            return;
        }
        if (!sessionTokenPDA.current) {
            console.error("sessionTokenPDA not available");
            return;
        }
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
                sessionToken: sessionTokenPDA.current,
                payer: tempKeypair.current.publicKey,
            }).transaction() as Transaction;

        // Add instruction to print to the noop program and and make the transaction unique
        const noopInstruction = new TransactionInstruction({
            programId: new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'),
            keys: [],
            data: Buffer.from(crypto.getRandomValues(new Uint8Array(5))),
        });
        transaction.add(noopInstruction);

        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        try {
            let connectionToUse = isDelegated ? ephemeralConnection.current : connection;
            if (!connectionToUse) return;
            
            const {
                value: { blockhash, lastValidBlockHeight }
            } = await connectionToUse.getLatestBlockhashAndContext();
            if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
            if (!transaction.feePayer) transaction.feePayer = tempKeypair.current.publicKey;
            
            transaction.sign(tempKeypair.current);
            
            const signature = await connectionToUse.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
            await connectionToUse.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
            console.log(`Transaction confirmed: ${signature}`);
            setTransactionSuccess(`Counter incremented`);
        } catch (error) {
            setTransactionError(`Transaction failed: ${error}`);
        } finally {
            setIsSubmitting(false);
        }
    }, [isDelegated, counterPda, sessionTokenPDA, connection, transferToTempKeypair]);

    /**
     * Initialize counter transaction
     */
    const initializeCounterTx = useCallback(async () => {
        if (!publicKey || !counterProgramClient.current || !counterPda) return;

        const transaction = await counterProgramClient.current.methods
            .initialize()
            .accounts({
                user: publicKey,
            })
            .transaction();

        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        try {
            const {
                value: { blockhash, lastValidBlockHeight }
            } = await connection.getLatestBlockhashAndContext();
            if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
            if (!transaction.feePayer) transaction.feePayer = publicKey;

            const signature = await sendTransaction(transaction, connection);
            await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
            console.log(`Transaction confirmed: ${signature}`);
            setTransactionSuccess(`Counter initialized successfully`);
        } catch (error) {
            setTransactionError(`Transaction failed: ${error}`);
        } finally {
            setIsSubmitting(false);
        }
    }, [publicKey, counterProgramClient, counterPda, connection, sendTransaction]);

    /**
     * Create session transaction
     */
    const createSessionTx = useCallback(async () => {
        if (!publicKey || !tempKeypair.current || !sessionTokenManager.current) return;
        
        const topUp = true;
        const validUntilBN = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // valid for 1 hour
        const topUpLamportsBN = new anchor.BN(0.0005 * LAMPORTS_PER_SOL);

        const transaction = await sessionTokenManager.current.program.methods
            .createSession(topUp, validUntilBN, topUpLamportsBN)
            .accounts({
                targetProgram: COUNTER_PROGRAM,
                sessionSigner: tempKeypair.current.publicKey,
                authority: publicKey,
            })
            .transaction();

        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        try {
            const {
                context: { slot: minContextSlot },
                value: { blockhash, lastValidBlockHeight }
            } = await connection.getLatestBlockhashAndContext();
            if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
            if (!transaction.feePayer) transaction.feePayer = publicKey;
            
            // Sign with tempKeypair first
            transaction.sign(tempKeypair.current);
            
            // Then sign with wallet adapter
            const signature = await sendTransaction(transaction, connection, { minContextSlot });
            await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
            console.log(`Transaction confirmed: ${signature}`);
            setTransactionSuccess(`Session created successfully`);
        } catch (error) {
            setTransactionError(`Transaction failed: ${error}`);
        } finally {
            setIsSubmitting(false);
        }
    }, [publicKey, connection, sendTransaction]);

    /**
     * Delegate PDA transaction
     */
    const delegatePdaTx = useCallback(async () => {
        console.log("Delegate PDA transaction");
        console.log(tempKeypair.current);
        if (!tempKeypair.current) return;
        if (!counterPda) return;
        if (!sessionTokenPDA.current) return;
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
                pda: counterPda,
                sessionToken: sessionTokenPDA.current,
            })
            .remainingAccounts(remainingAccounts)
            .transaction() as Transaction;
        
        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        try {
            const {
                value: { blockhash, lastValidBlockHeight }
            } = await connection.getLatestBlockhashAndContext();
            if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
            if (!transaction.feePayer) transaction.feePayer = tempKeypair.current.publicKey;
            
            transaction.sign(tempKeypair.current);
            
            const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
            await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
            setEphemeralCounter(Number(counter));
            console.log(`Transaction confirmed: ${signature}`);
            setTransactionSuccess(`Delegation successful`);
        } catch (error) {
            setTransactionError(`Transaction failed: ${error}`);
        } finally {
            setIsSubmitting(false);
        }
    }, [counterPda, sessionTokenPDA, connection, counter, transferToTempKeypair]);

    /**
     * Undelegate PDA transaction
     */
    const undelegatePdaTx = useCallback(async () => {
        if (!tempKeypair.current) return;
        if (!counterPda) return;
        if (!sessionTokenPDA.current) return;
        if (!ephemeralConnection.current) return;
        console.log("Undelegate PDA transaction");
        
        const transaction = await counterProgramClient.current?.methods
            .undelegate()
            .accounts({
                payer: tempKeypair.current.publicKey,
                counter: counterPda,
                sessionToken: sessionTokenPDA.current,
            })
            .transaction() as Transaction;

        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        try {
            const {
                value: { blockhash, lastValidBlockHeight }
            } = await ephemeralConnection.current.getLatestBlockhashAndContext();
            if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
            if (!transaction.feePayer) transaction.feePayer = tempKeypair.current.publicKey;
            
            transaction.sign(tempKeypair.current);
            
            const signature = await ephemeralConnection.current.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
            await ephemeralConnection.current.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
            console.log(`Transaction confirmed: ${signature}`);
            setTransactionSuccess(`Undelegation successful`);
        } catch (error) {
            setTransactionError(`Transaction failed: ${error}`);
        } finally {
            setIsSubmitting(false);
        }
    }, [tempKeypair, counterPda, sessionTokenPDA, ephemeralConnection]);

    /**
     * Revoke session transaction
     */
    const revokeSessionTx = useCallback(async () => {
        if (!publicKey || !sessionTokenPDA.current || !sessionTokenManager.current) return;

        const transaction = await sessionTokenManager.current.program.methods
            .revokeSession()
            .accounts({
                sessionToken: sessionTokenPDA.current,
            })
            .transaction();

        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        try {
            const {
                value: { blockhash, lastValidBlockHeight }
            } = await connection.getLatestBlockhashAndContext();
            if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
            if (!transaction.feePayer) transaction.feePayer = publicKey;

            // Sign with wallet adapter
            const signature = await sendTransaction(transaction, connection);
            await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
            console.log(`Transaction confirmed: ${signature}`);
            setTransactionSuccess(`Session revoked successfully`);
        } catch (error) {
            setTransactionError(`Transaction failed: ${error}`);
        } finally {
            setIsSubmitting(false);
        }
    }, [publicKey, sessionTokenPDA, sessionTokenManager, connection, sendTransaction]);

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
                <Button title={"Initialize Counter"} resetGame={initializeCounterTx} disabled={false}/>
                <Button title={"Create Session"} resetGame={createSessionTx} disabled={false}/>
                <Button title={"Revoke Session"} resetGame={revokeSessionTx} disabled={false}/>
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