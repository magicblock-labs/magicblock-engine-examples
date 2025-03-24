import React, { useCallback, useEffect, useRef, useState } from "react";
import { WalletNotConnectedError } from '@solana/wallet-adapter-base';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Alert from "./components/Alert";
import {Logs, PublicKey, Transaction} from "@solana/web3.js";
import {Program, Provider, web3} from "@coral-xyz/anchor";
import { SimpleProvider } from "./components/Wallet";
import Response from "./components/Response";
import Signature from "./components/Signature";

const AGENT_PROGRAM = new PublicKey("agnmDKzZkv63sRhPFvm3iWpxaopgTRcohXA6CSYSXvQ");
const LLM_PROGRAM = new PublicKey("LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab");
const App: React.FC = () => {
    let { connection } = useConnection();
    const provider = useRef<Provider>(new SimpleProvider(connection));
    const prevSignature = useRef<string | null>(null);
    const { publicKey, sendTransaction } = useWallet();
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [transactionError, setTransactionError] = useState<string | null>(null);
    const [transactionSuccess, setTransactionSuccess] = useState<string | null>(null);
    const [agentReply, setAgentReply] = useState<[string, bigint, string] | null>(null);
    const [isClientInitialized, setIsClientInitialized] = useState<boolean>(false);
    const [inputText, setInputText] = useState<string>("");

    const agentProgramClient = useRef<Program | null>(null);
    const agentAddress = useRef<PublicKey | null>(null);
    const agent = useRef<any | null>(null);

    // Helpers to Dynamically fetch the IDL and initialize the program client
    const getProgramClient = useCallback(async (programId: PublicKey): Promise<Program> => {
        const idl = await Program.fetchIdl(programId, provider.current);
        if (!idl) throw new Error('IDL not found');
        return new Program(idl, provider.current);
    }, [provider]);

    const getInteractionAddress = useCallback(async () => {
        if (!publicKey) throw new WalletNotConnectedError();
        const interactionAddress = web3.PublicKey.findProgramAddressSync(
            [
                Buffer.from("interaction"),
                publicKey.toBuffer(),
                agent.current.context.toBuffer(),
            ],
            LLM_PROGRAM
        )[0];
        return interactionAddress;
    },[publicKey, agent]);

    const processLogs = useCallback(async (logs: Logs) => {
        let reply = null;
        let amount = null;
        logs.logs.forEach((log) => {
            if(log.includes("Agent Reply:")) {
                reply = log.replace("Agent Reply:", "").replace("Program log: ", "").trim().replace(/^"|"$/g, '');
            }
            if(log.includes("Amount:")) {
                try {
                    amount = BigInt(log.replace("Amount:", "").replace("Program log: ", "").trim());
                } catch (error) {
                    amount = BigInt(0);
                }
            }
        });
        console.log(`previous signature: ${prevSignature.current}, current signature: ${logs.signature}`);
        if(reply && amount !== null && prevSignature.current !== logs.signature) {
            prevSignature.current = logs.signature;
            console.log(`Agent response: ${reply}, amount: ${amount}, transaction: ${logs.signature}`);
            setIsLoading(false);
            setAgentReply([reply, amount, logs.signature]);
            if (amount > 0) {
                setTransactionSuccess(`Received some tokens: ${amount}`);
            }
        }
    },[prevSignature]);

    useEffect(() => {
        const initializeProgramClient = async () => {
            agentProgramClient.current = await getProgramClient(AGENT_PROGRAM);
            agentAddress.current = web3.PublicKey.findProgramAddressSync(
                [Buffer.from("agent")],
                agentProgramClient.current.programId
            )[0];
            // @ts-ignore
            agent.current = await agentProgramClient.current.account.agent.fetch(agentAddress.current);
            const interactionAddress = await getInteractionAddress();
            connection.onLogs(interactionAddress, (logs) => {
                processLogs(logs);
            }, "processed");
            setIsClientInitialized(true);
        };
        initializeProgramClient().catch(console.error);
    }, [connection, getProgramClient, getInteractionAddress, processLogs]);

    const submitTransaction = useCallback(async (transaction: Transaction): Promise<string | null> => {
        if (isSubmitting) return null;
        setIsSubmitting(true);
        setTransactionError(null);
        setTransactionSuccess(null);
        try {
            const {
                context: { slot: minContextSlot },
                value: { blockhash, lastValidBlockHeight }
            } = await connection.getLatestBlockhashAndContext();

            const signature = await sendTransaction(transaction, connection, { minContextSlot });
            await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");

            // Transaction was successful
            console.log(`Transaction confirmed: ${signature}`);
            setIsLoading(true);
            setTransactionSuccess(`Transaction confirmed`);
            return signature;
        } catch (error) {
            setTransactionError(`Transaction failed: ${error}`);
        } finally {
            setIsSubmitting(false);
        }
        return null;
    }, [connection, isSubmitting, sendTransaction]);

    const doInteractionTx = useCallback(async (inputText: string) => {
        if (!publicKey) throw new WalletNotConnectedError();
        if (!isClientInitialized || !agentProgramClient.current) throw new Error("Program client is not initialized");
        if (!agent || !agent.current) throw new Error("Agent not found");

        console.log("Text:", inputText);
        const interactionAddress = await getInteractionAddress();

        const transaction = await agentProgramClient.current?.methods
            .interactAgent(inputText)
            .accounts({
                payer: publicKey,
                interaction: interactionAddress,
                contextAccount: agent.current.context,
            }).transaction() as Transaction;

        transaction.feePayer = publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        const signature = await submitTransaction(transaction) as string;
        console.log("Signature:", signature);
        setInputText("")
    }, [connection, publicKey, submitTransaction, isClientInitialized, getInteractionAddress]);

    useEffect(() => {
        // get both pupils
        const pupils = document.querySelectorAll(".eye .pupil");

        const handleMouseMove = (e: MouseEvent) => {
            pupils.forEach((pupil) => {
                // get x and y position of cursor
                const rect = pupil.getBoundingClientRect();
                const x = (e.pageX - rect.left) / 30 + "px";
                const y = (e.pageY - rect.top) / 30 + "px";
                // @ts-ignore
                pupil.style.transform = "translate3d(" + x + "," + y + ", 0px)";
            });
        };

        window.addEventListener("mousemove", handleMouseMove);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
        };
    }, []);
    return (
        <div className="agent-interaction">
            <div className="wallet-buttons" style={{textAlign: 'center'}}>
                <WalletMultiButton/>
            </div>

            <h1> Who are you? </h1>

            <div className="eyes">
                <div className="eye">
                    <div className="pupil"></div>
                </div>
                <div className="eye">
                    <div className="pupil"></div>
                </div>
            </div>

            <div className="interact-agent">
                <input
                    style={{width: '40rem'}}
                    type="text"
                    placeholder=""
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                            setAgentReply(null);
                            await doInteractionTx(inputText);
                        }
                    }}
                />
            </div>

            <div style={{textAlign: 'center', width: '40rem'}}>
                <div className="response-text" style={{marginTop: '10px', textAlign: 'center'}}>
                    <Response loading={isLoading} message={agentReply?.[0]}
                              onClose={() => setAgentReply(null)}></Response>
                </div>

                <div className="response-text" style={{marginTop: '10px', textAlign: 'center'}}>
                    <Signature devnet={connection.rpcEndpoint.includes('devnet')} message={agentReply?.[2]} onClose={() => setAgentReply(null)}></Signature>                </div>
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

            <a href="https://github.com/GabrielePicco/super-smart-contracts" target="_blank" rel="noreferrer">
                <img src={`${process.env.PUBLIC_URL}/github-mark-white.svg`} alt="Github logo" className="github-logo"/>
            </a>
        </div>
    );
};

export default App;
