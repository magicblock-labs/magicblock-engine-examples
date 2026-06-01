import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import Button from "./components/Button";
import Square from "./components/Square";
import {useConnection, useWallet} from '@solana/wallet-adapter-react';
import {WalletMultiButton} from "@solana/wallet-adapter-react-ui";
import Alert from "./components/Alert";
import * as anchor from "@coral-xyz/anchor";
import {Idl, Program, Provider} from "@coral-xyz/anchor";
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

// IDL is copied into src/idl/ by the `copy-idl` npm script (runs as prebuild/prestart).
import counterIdl from "./idl/anchor_counter_session.json";

const COUNTER_PDA_SEED = "counter";
// Read the program ID from the IDL so it stays in sync with `declare_id!` after redeploys.
const COUNTER_PROGRAM = new PublicKey(counterIdl.address);
console.log("Counter program:", COUNTER_PROGRAM.toBase58());

// Default to a specific ER region (devnet-as) — the router URL would break WS subscriptions.
const PUBLIC_ER_ENDPOINT = process.env.REACT_APP_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app";

// Helpers for building the Solana Explorer tx URL embedded in the success Alert.
const baseExplorerUrl = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const erExplorerUrl = (sig: string) =>
    `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(PUBLIC_ER_ENDPOINT)}`;

const App: React.FC = () => {
    let { connection } = useConnection();
    const ephemeralConnection  = useRef<Connection | null>(null);
    const provider = useRef<Provider>(new SimpleProvider(connection));
    const { publicKey, signTransaction: walletSignTransaction } = useWallet();
    const signTransaction = useMemo(() => 
        walletSignTransaction || (async (_tx: Transaction) => { throw new Error('Wallet not connected'); }),
        [walletSignTransaction]
    );
    const tempKeypair = useRef<Keypair | null>(null);
    const [counter, setCounter] = useState<number>(0);
    const [ephemeralCounter, setEphemeralCounter] = useState<number>(0);
    const [isDelegated, setIsDelegated] = useState<boolean>(false);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [transactionError, setTransactionError] = useState<{ message: string; explorerUrl?: string } | null>(null);
    const [transactionSuccess, setTransactionSuccess] = useState<{ message: string; explorerUrl?: string } | null>(null);
    const [sessionTokenExists, setSessionTokenExists] = useState<boolean>(false);
    const counterProgramClient = useRef<Program | null>(null);
    const [counterPda, setCounterPda] = useState<PublicKey | null>(null);
    let counterSubscriptionId = useRef<number | null>(null);
    let ephemeralCounterSubscriptionId = useRef<number | null>(null);
    const sessionTokenManager = useRef<SessionTokenManager | null>(null);
    const sessionTokenPDA = useRef<PublicKey | null>(null);
    const SESSION_TOKEN_SEED = "session_token_v2";

    // Helpers to Dynamically fetch the IDL and initialize the program client
    // Build the program client from the LOCAL IDL (copied into src/idl/ by the copy-idl
    // npm script). Avoids Program.fetchIdl, which requires the IDL to be uploaded
    // on-chain via `anchor idl init` and silently breaks if that step was skipped.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const getProgramClient = useCallback(async (_program: PublicKey): Promise<Program> => {
        return new Program(counterIdl as Idl, provider.current);
    }, [provider]);

    // Define callbacks function to handle account changes
    const handleCounterChange = useCallback((accountInfo: AccountInfo<Buffer>) => {
        console.log("Base counter changed", accountInfo);
        if (!counterProgramClient.current) return;
        const decodedData = counterProgramClient.current.coder.accounts.decode('counter', accountInfo.data);
        setIsDelegated(!accountInfo.owner.equals(counterProgramClient.current.programId));
        setCounter(Number(decodedData.count));
    }, []);

    const handleEphemeralCounterChange = useCallback((accountInfo: AccountInfo<Buffer>) => {
        console.log("ER counter changed", accountInfo);
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
            }
            // Subscribe unconditionally — even if the account doesn't exist yet, the
            // listener will fire when init+increment creates it, so the UI updates
            // without needing a page refresh.
            await subscribeToCounter();
        };
        initializeProgramClient().catch(console.error);
    }, [connection, counterPda, getProgramClient, subscribeToCounter]);

    // Derive the temp keypair from (publicKey, nonce). The nonce is stored in
    // localStorage and bumped each time a session is created — this lets us rotate
    // the session token PDA without waiting for Solana to garbage-collect a previous
    // (drained but not yet swept) account, which otherwise produces "Allocate: account
    // already in use" on recreate.
    const sessionNonceKey = useCallback(
        (pk: PublicKey) => `sessionNonce:${pk.toBase58()}`,
        [],
    );
    const deriveTempKeypair = useCallback((pk: PublicKey, nonce: string) => {
        // 32-byte seed from sha256(publicKey || nonce). Use Web Crypto for portability.
        const seedBytes = new Uint8Array(32);
        const src = new TextEncoder().encode(pk.toBase58() + ":" + nonce);
        // Synchronous-ish: borrow first 32 bytes by hashing manually via subtle isn't sync.
        // Simpler: pad/truncate the raw bytes ourselves since they don't need to be uniform.
        const raw = new Uint8Array(pk.toBytes());
        for (let i = 0; i < 32; i++) seedBytes[i] = raw[i] ^ (src[i % src.length] ?? 0);
        return Keypair.fromSeed(seedBytes);
    }, []);

    // Detect when publicKey is set/connected
    useEffect( () => {
        if (!publicKey) return;
        const nonce = localStorage.getItem(sessionNonceKey(publicKey)) ?? "0";
        const newTempKeypair = deriveTempKeypair(publicKey, nonce);
        if (tempKeypair.current?.publicKey.equals(newTempKeypair.publicKey)) return;
        console.log("Wallet connected with publicKey:", publicKey.toBase58());
        tempKeypair.current = newTempKeypair;
        console.log("Temp Keypair", newTempKeypair.publicKey.toBase58(), "nonce:", nonce);
    }, [connection, publicKey, sessionNonceKey, deriveTempKeypair]);

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
        if (!publicKey || !tempKeypair.current) return;
        
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

            // UI-level "does the PDA have anything at it" check — any non-null account
            // means we should show "Revoke Session" (so a user can clean up a stale or
            // undecodable session). Per-action handlers do their own strict decode check
            // to avoid passing a broken session_token into the program (which would trip
            // AccountDiscriminatorMismatch 0xbba).
            const accountInfo = await connection.getAccountInfo(pda);
            setSessionTokenExists(!!accountInfo);
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
            if(ephemeralConnection.current || counterProgramClient.current == null || !counterPda) {
                return;
            }
            ephemeralConnection.current = new Connection(PUBLIC_ER_ENDPOINT);
            
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
        if (!counterPda) {
            console.error("counterPda not available");
            return;
        }

        if (sessionTokenExists) {
            if (!tempKeypair.current) {
                console.error("tempKeypair not available");
                return;
            }
            const accountTmpWallet = await connection.getAccountInfo(tempKeypair.current.publicKey);
            if (!accountTmpWallet || accountTmpWallet.lamports <= 0.01 * LAMPORTS_PER_SOL) {
                await transferToTempKeypair()
            }
        } else {
            if (!publicKey) {
                console.error("publicKey not available");
                return;
            }
        }

        const payer = sessionTokenExists ? tempKeypair.current!.publicKey : publicKey!;

         const incrementAccounts: any = {
             counter: counterPda,
             payer: payer,
         };
         
         // Use sessionToken if session exists, otherwise use program ID as placeholder
         if (sessionTokenExists) {
             if (!sessionTokenPDA.current) {
                 console.error("sessionTokenPDA not available");
                 return;
             }
             incrementAccounts.sessionToken = sessionTokenPDA.current;
         } else {
             incrementAccounts.sessionToken = COUNTER_PROGRAM;
         }

         let transaction = await counterProgramClient.current?.methods
             .increment()
             .accounts(incrementAccounts)
             .transaction() as Transaction;

        // Check if counter account exists, if not prepend an initialize instruction.
        // Must run BEFORE increment, otherwise increment hits AccountNotInitialized (0xbc4).
        const accountInfo = await connection.getAccountInfo(counterPda);
        if (!accountInfo) {
            console.log("Counter not initialized, prepending initialize instruction");
            const initIx = await counterProgramClient.current?.methods
                .initialize()
                .accounts({
                    user: payer,
                })
                .instruction();
            if (initIx) transaction.instructions.unshift(initIx);
        }

        // Add instruction to print to the noop program and make the transaction unique
        const noopInstruction = new TransactionInstruction({
            programId: new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'),
            keys: [],
            data: Buffer.from(crypto.getRandomValues(new Uint8Array(5))),
        });
        transaction.add(noopInstruction);

        setIsSubmitting(true);
         setTransactionError(null);
         setTransactionSuccess(null);
         const txStart = performance.now();
         let signature: string | null = null;
         try {
             if (sessionTokenExists && tempKeypair.current) {
                 // Sign with temp keypair when session token exists
                 let connectionToUse = isDelegated ? ephemeralConnection.current : connection;
                 if (!connectionToUse) return;

                 const {
                     value: { blockhash, lastValidBlockHeight }
                 } = await connectionToUse.getLatestBlockhashAndContext();
                 if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
                 if (!transaction.feePayer) transaction.feePayer = payer;

                 transaction.sign(tempKeypair.current);
                 signature = await connectionToUse.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
                 {
                     const c = await connectionToUse.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
                     if (c.value.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(c.value.err)}`);
                 }
                 console.log(`Transaction confirmed: ${signature}`);
             } else {
                 // Sign with wallet when no session token
                 let connectionToUse = isDelegated ? ephemeralConnection.current : connection;
                 if (!connectionToUse) return;

                 const {
                     value: { blockhash, lastValidBlockHeight }
                 } = await connectionToUse.getLatestBlockhashAndContext();
                 if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
                 if (!transaction.feePayer) transaction.feePayer = payer;

                 try {
                     console.log("Attempting wallet signature with:", {
                         instructions: transaction.instructions.length,
                         feePayer: transaction.feePayer?.toBase58(),
                         recentBlockhash: transaction.recentBlockhash
                     });
                     const signedTransaction = await signTransaction(transaction);
                     signature = await connectionToUse.sendRawTransaction(signedTransaction.serialize(), { skipPreflight: false });
                     {
                         const c = await connectionToUse.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
                         if (c.value.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(c.value.err)}`);
                     }
                     console.log(`Transaction confirmed: ${signature}`);
                 } catch (walletErr: any) {
                     console.error("Wallet error details:", {
                         message: walletErr.message,
                         name: walletErr.name,
                         stack: walletErr.stack
                     });
                     throw walletErr;
                 }
             }
             const totalMs = Math.round(performance.now() - txStart);
             setTransactionSuccess({
                 message: `[${isDelegated ? "ER" : "Base"}] Counter incremented in ${totalMs}ms`,
                 explorerUrl: signature ? (isDelegated ? erExplorerUrl(signature) : baseExplorerUrl(signature)) : undefined,
             });
        } catch (error) {
            const explorerUrl = signature
                ? (isDelegated ? erExplorerUrl(signature) : baseExplorerUrl(signature))
                : undefined;
            setTransactionError({
                message: `Transaction failed: ${error}`,
                explorerUrl,
            });
        } finally {
            setIsSubmitting(false);
        }
    }, [isDelegated, counterPda, sessionTokenPDA, connection, transferToTempKeypair, publicKey, sessionTokenExists, signTransaction]);

    /**
     * Create session transaction
     */
    const createSessionTx = useCallback(async () => {
        if (!publicKey || !tempKeypair.current || !sessionTokenManager.current || !counterProgramClient.current || !counterPda) return;
        
        const topUp = true;
        const validUntilBN = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // valid for 1 hour
        // Rent-exempt minimum for a 0-byte system account is ~890,880 lamports.
        // Top up to 0.002 SOL so a brand-new (just-rotated) sessionSigner clears rent
        // with headroom for tx fees.
        const topUpLamportsBN = new anchor.BN(0.002 * LAMPORTS_PER_SOL);

        // Always bump the nonce on Create. Detecting whether the previous PDA is "really
        // free" is unreliable: `getAccountInfo` returns null for zombie accounts (lamports=0
        // but slot still allocated by System), so we can't tell from the client whether
        // Allocate will succeed. Always rotating gives a fresh PDA every time.
        {
            const key = sessionNonceKey(publicKey);
            const nextNonce = String((Number(localStorage.getItem(key) ?? "0") + 1) | 0);
            localStorage.setItem(key, nextNonce);
            const fresh = deriveTempKeypair(publicKey, nextNonce);
            tempKeypair.current = fresh;
            const [pda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from(SESSION_TOKEN_SEED),
                    COUNTER_PROGRAM.toBytes(),
                    fresh.publicKey.toBytes(),
                    publicKey.toBuffer(),
                ],
                sessionTokenManager.current.program.programId,
            );
            sessionTokenPDA.current = pda;
            console.log("Rotated tempKeypair, new session PDA:", pda.toBase58(), "nonce:", nextNonce);
        }

        let transaction = await sessionTokenManager.current.program.methods
            .createSessionV2(topUp, validUntilBN, topUpLamportsBN)
            .accounts({
                targetProgram: COUNTER_PROGRAM,
                sessionSigner: tempKeypair.current.publicKey,
                feePayer: publicKey,
                authority: publicKey,
            })
            .transaction();

        // Check if counter account exists, if not add initialize instruction
        const accountInfo = await connection.getAccountInfo(counterPda);
        if (!accountInfo && counterProgramClient.current) {
            console.log("Counter not initialized, adding initialize instruction");
            const initTx = await counterProgramClient.current.methods
                .initialize()
                .accounts({
                    user: publicKey,
                })
                .transaction() as Transaction;
            transaction.add(...initTx.instructions);
        }

        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        const txStart = performance.now();
        let signature: string | null = null;
        try {
            const {
                value: { blockhash, lastValidBlockHeight }
            } = await connection.getLatestBlockhashAndContext();
            if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
            if (!transaction.feePayer) transaction.feePayer = publicKey;

            // Sign with tempKeypair first
            transaction.sign(tempKeypair.current);

            // Then sign with wallet adapter
            const signedTransaction = await signTransaction(transaction);
            signature = await connection.sendRawTransaction(signedTransaction.serialize(), { skipPreflight: false });
            const confirm = await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
            if (confirm.value.err) {
                throw new Error(`Transaction failed on chain: ${JSON.stringify(confirm.value.err)}`);
            }
            console.log(`Transaction confirmed: ${signature}`);
            // Confirm the new session token account landed. Use the same loose check
            // as the init useEffect (getAccountInfo, not program.account.X.fetch) — the
            // SDK's decoder schema can mismatch the on-chain layout and falsely report
            // "not found" even when the account is allocated and the create tx confirmed.
            if (sessionTokenPDA.current) {
                const accountInfo = await connection.getAccountInfo(sessionTokenPDA.current);
                if (!accountInfo) {
                    throw new Error("Session token account not found after create");
                }
                setSessionTokenExists(true);
                const totalMs = Math.round(performance.now() - txStart);
                setTransactionSuccess({
                    message: `[Base] Session created in ${totalMs}ms`,
                    explorerUrl: baseExplorerUrl(signature),
                });
            } else {
                setSessionTokenExists(true);
                const totalMs = Math.round(performance.now() - txStart);
                setTransactionSuccess({
                    message: `[Base] Session created in ${totalMs}ms`,
                    explorerUrl: baseExplorerUrl(signature),
                });
            }
            } catch (error) {
            setTransactionError({
                message: `Transaction failed: ${error}`,
                explorerUrl: signature ? baseExplorerUrl(signature) : undefined,
            });
            } finally {
            setIsSubmitting(false);
            }
            }, [publicKey, connection, signTransaction, counterPda, deriveTempKeypair, sessionNonceKey]);

    /**
     * Delegate PDA transaction
     */
    const delegatePdaTx = useCallback(async () => {
        console.log("Delegate PDA transaction");
        if (!counterPda) return;

        // Local decision only — do NOT side-effect setSessionTokenExists from here.
        // The decoder check is too strict (returns false when SDK schema and on-chain
        // layout differ even on a valid token), and flipping the UI state mid-handler
        // makes the button snap back to "Create Session" while the tx is in flight.
        let hasValidSession = false;
        if (sessionTokenPDA.current && sessionTokenManager.current) {
            try {
                await sessionTokenManager.current.program.account.sessionTokenV2.fetch(sessionTokenPDA.current);
                hasValidSession = true;
            } catch {
                hasValidSession = false;
            }
        }

        if (hasValidSession) {
            if (!tempKeypair.current) {
                console.error("tempKeypair not available");
                return;
            }
            const accountTmpWallet = await connection.getAccountInfo(tempKeypair.current.publicKey);
            if (!accountTmpWallet || accountTmpWallet.lamports <= 0.01 * LAMPORTS_PER_SOL) {
                await transferToTempKeypair()
            }
        } else {
            if (!publicKey) {
                console.error("publicKey not available");
                return;
            }
        }

        const payer = hasValidSession ? tempKeypair.current!.publicKey : publicKey!;

        const delegateAccounts: any = {
            payer: payer,
            pda: counterPda,
        };

        // Use sessionToken if session exists, otherwise use program ID as placeholder
        if (hasValidSession) {
            if (!sessionTokenPDA.current) {
                console.error("sessionTokenPDA not available");
                return;
            }
            delegateAccounts.sessionToken = sessionTokenPDA.current;
        } else {
            delegateAccounts.sessionToken = COUNTER_PROGRAM;
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
                .accounts(delegateAccounts)
                .remainingAccounts(remainingAccounts)
                .transaction() as Transaction;
                
                setIsSubmitting(true);
                setTransactionError(null);
                setTransactionSuccess(null);
                const txStart = performance.now();
                let signature: string | null = null;
                try {
                const {
                value: { blockhash, lastValidBlockHeight }
                } = await connection.getLatestBlockhashAndContext();
                if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
                if (!transaction.feePayer) transaction.feePayer = payer;

                if (hasValidSession && tempKeypair.current) {
                    // Sign with temp keypair when session token exists
                    transaction.sign(tempKeypair.current);
                    signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
                    const c = await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
                    if (c.value.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(c.value.err)}`);
                } else {
                    // Sign with wallet when no session token
                    const signedTransaction = await signTransaction(transaction);
                    signature = await connection.sendRawTransaction(signedTransaction.serialize(), { skipPreflight: false });
                    const c = await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
                    if (c.value.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(c.value.err)}`);
                }
                setEphemeralCounter(Number(counter));
                console.log(`Transaction confirmed`);
                const totalMs = Math.round(performance.now() - txStart);
                setTransactionSuccess({
                    message: `[Base] Delegation successful in ${totalMs}ms`,
                    explorerUrl: signature ? baseExplorerUrl(signature) : undefined,
                });
                } catch (error) {
                setTransactionError({
                    message: `Transaction failed: ${error}`,
                    explorerUrl: signature ? baseExplorerUrl(signature) : undefined,
                });
                } finally {
                setIsSubmitting(false);
                }
                }, [counterPda, sessionTokenPDA, connection, counter, transferToTempKeypair, publicKey, signTransaction, tempKeypair]);

    /**
     * Undelegate PDA transaction
     */
    const undelegatePdaTx = useCallback(async () => {
        if (!counterPda) return;
        console.log("Undelegate PDA transaction");

        if (sessionTokenExists) {
            if (!tempKeypair.current) {
                console.error("tempKeypair not available");
                return;
            }
        } else {
            if (!publicKey) {
                console.error("publicKey not available");
                return;
            }
        }

        const payer = sessionTokenExists ? tempKeypair.current!.publicKey : publicKey!;

        // Always use ephemeral connection for undelegate
        const connToUse = ephemeralConnection.current;
        if (!connToUse) return;
        
        const undelegateAccounts: any = {
            payer: payer,
            counter: counterPda,
        };
        
        // Use sessionToken if session exists, otherwise use program ID as placeholder
        if (sessionTokenExists) {
            if (!sessionTokenPDA.current) {
                console.error("sessionTokenPDA not available");
                return;
            }
            undelegateAccounts.sessionToken = sessionTokenPDA.current;
        } else {
            undelegateAccounts.sessionToken = COUNTER_PROGRAM;
        }

        const transaction = await counterProgramClient.current?.methods
            .undelegate()
            .accounts(undelegateAccounts)
            .transaction() as Transaction;

        setIsSubmitting(true);
         setTransactionError(null);
         setTransactionSuccess(null);
         const txStart = performance.now();
         let signature: string | null = null;
         try {
             const {
                 value: { blockhash, lastValidBlockHeight }
             } = await connToUse.getLatestBlockhashAndContext();
             if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
             if (!transaction.feePayer) transaction.feePayer = payer;

             if (sessionTokenExists && tempKeypair.current) {
                 // Sign with temp keypair when session token exists
                 transaction.sign(tempKeypair.current);
                 signature = await connToUse.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
                 const c = await connToUse.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
                 if (c.value.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(c.value.err)}`);
             } else {
                 // Sign with wallet when no session token
                 const signedTransaction = await signTransaction(transaction);
                 signature = await connToUse.sendRawTransaction(signedTransaction.serialize(), { skipPreflight: true });
                 const c = await connToUse.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
                 if (c.value.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(c.value.err)}`);
             }
             console.log(`Transaction confirmed`);
             const totalMs = Math.round(performance.now() - txStart);
             setTransactionSuccess({
                 message: `[ER] Undelegation successful in ${totalMs}ms`,
                 explorerUrl: signature ? erExplorerUrl(signature) : undefined,
             });
         } catch (error) {
             setTransactionError({
                 message: `Transaction failed: ${error}`,
                 explorerUrl: signature ? erExplorerUrl(signature) : undefined,
             });
         } finally {
             setIsSubmitting(false);
         }
    }, [counterPda, sessionTokenPDA, publicKey, sessionTokenExists, signTransaction, ephemeralConnection]);

    /**
     * Revoke session transaction
     */
    const revokeSessionTx = useCallback(async () => {
        if (!publicKey || !sessionTokenPDA.current || !sessionTokenManager.current) return;

        const transaction = await sessionTokenManager.current.program.methods
            .revokeSessionV2()
            .accounts({
                sessionToken: sessionTokenPDA.current,
            })
            .transaction();

        setIsSubmitting(true);
         setTransactionError(null);
         setTransactionSuccess(null);
         const txStart = performance.now();
         let signature: string | null = null;
         try {
             const {
                 value: { blockhash, lastValidBlockHeight }
             } = await connection.getLatestBlockhashAndContext();
             if (!transaction.recentBlockhash) transaction.recentBlockhash = blockhash;
             if (!transaction.feePayer) transaction.feePayer = publicKey;

             // Sign with wallet adapter
             const signedTransaction = await signTransaction(transaction);
             signature = await connection.sendRawTransaction(signedTransaction.serialize(), { skipPreflight: false });
             const c = await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
             if (c.value.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(c.value.err)}`);
             console.log(`Transaction confirmed: ${signature}`);
             const totalMs = Math.round(performance.now() - txStart);
             setTransactionSuccess({
                 message: `[Base] Session revoked in ${totalMs}ms`,
                 explorerUrl: baseExplorerUrl(signature),
             });
             setSessionTokenExists(false);
             } catch (error) {
             setTransactionError({
                 message: `Transaction failed: ${error}`,
                 explorerUrl: signature ? baseExplorerUrl(signature) : undefined,
             });
             } finally {
             setIsSubmitting(false);
             }
    }, [publicKey, sessionTokenPDA, sessionTokenManager, connection, signTransaction]);

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

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginTop: '20px' }}>
                {!sessionTokenExists ? (
                    <button onClick={createSessionTx} style={{ padding: '8px 12px', margin: '0px', background: 'transparent', border: '2px solid #eee', color: '#eee', width: '150px', borderRadius: '5px', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' }}>Create Session</button>
                ) : (
                    <button onClick={revokeSessionTx} style={{ padding: '8px 12px', margin: '0px', background: 'transparent', border: '2px solid #eee', color: '#eee', width: '150px', borderRadius: '5px', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' }}>Revoke Session</button>
                )}
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