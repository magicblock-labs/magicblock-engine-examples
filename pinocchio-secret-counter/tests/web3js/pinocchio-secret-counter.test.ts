import { 
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    Connection,
    sendAndConfirmTransaction 
} from "@solana/web3.js";
import { initializeSolSignerKeypair, airdropSolIfNeeded } from "./initializeKeypair"; 
import * as borsh from "borsh";
import * as fs from "fs";
import { CounterInstruction, IncreaseCounterPayload } from "./schema";
import { 
    DELEGATION_PROGRAM_ID, 
    delegationRecordPdaFromDelegatedAccount, 
    delegationMetadataPdaFromDelegatedAccount, 
    delegateBufferPdaFromDelegatedAccountAndOwnerProgram, 
    MAGIC_CONTEXT_ID, 
    MAGIC_PROGRAM_ID, 
    PERMISSION_PROGRAM_ID,
    getAuthToken
} from "@magicblock-labs/ephemeral-rollups-sdk";
import * as nacl from 'tweetnacl';

import { describe, it, beforeAll, expect } from "vitest";

import dotenv from 'dotenv'
dotenv.config()



describe.skip("basic-test", async () => {
    const TEST_TIMEOUT = 60_000;
    console.log("pinocchio-counter.ts")

    // Get programId from target folder
    const keypairPath = "target/deploy/pinocchio_secret_counter-keypair.json";
    const secretKeyArray = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")));
    const keypair = Keypair.fromSecretKey(secretKeyArray);
    const PROGRAM_ID = keypair.publicKey;

    // Create user keypair and airdrop SOL if needed
    const userKeypair = initializeSolSignerKeypair(); 

    // Set up PER connection
    const teeUrl = process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://tee.magicblock.app";
    const teeWsUrl = process.env.EPHEMERAL_WS_ENDPOINT || "wss://tee.magicblock.app";
    const authToken = teeUrl.startsWith("https://tee") ? (await getAuthToken(teeUrl, userKeypair.publicKey, (message: Uint8Array) => Promise.resolve(nacl.sign.detached(message, userKeypair.secretKey)))).token : "";
    const teeUserUrl = `${teeUrl}?token=${authToken}`;
    const teeUserWsUrl = `${teeWsUrl}?token=${authToken}`;
    console.log("User Explorer URL:", `https://solscan.io/?cluster=custom&customUrl=${teeUserUrl}`);
  
    // Set up a connection to blockchain cluster
    const connectionBaseLayer = new Connection(
        process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com", 
        {wsEndpoint:process.env.WS_ENDPOINT || "wss://api.devnet.solana.com"}
    );
    const connectionEphemeralRollup = new Connection(
        process.env.EPHEMERAL_PROVIDER_ENDPOINT || teeUserUrl,
        {wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || teeUserWsUrl}
    );
    console.log("Base Layer Connection: ", connectionBaseLayer.rpcEndpoint);
    console.log("Ephemeral Rollup Connection: ", connectionEphemeralRollup.rpcEndpoint);


  
    // Run this once before all tests
    beforeAll( async () => {
        await airdropSolIfNeeded(connectionBaseLayer, userKeypair.publicKey, 2, 0.05);
    }, TEST_TIMEOUT);

    // Get pda of counter_account
    const [counterPda, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("counter"), userKeypair.publicKey.toBuffer()],
        PROGRAM_ID
    );
    console.log("Program ID: ", PROGRAM_ID.toString())
    console.log("Counter PDA: ", counterPda.toString())
    console.log("Bump: ", bump)

    // Get permission PDA
    const [permissionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("permission:"), counterPda.toBuffer()],
        PERMISSION_PROGRAM_ID
    );
    console.log("Permission PDA: ", permissionPda.toString())


    // Add local validator identity to the remaining accounts if running on localnet
    const remainingAccounts =
    connectionEphemeralRollup.rpcEndpoint.includes("localhost") ||
    connectionEphemeralRollup.rpcEndpoint.includes("127.0.0.1") || process.env.VALIDATOR
    ? [
        {
            pubkey: new PublicKey(process.env.VALIDATOR || "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
            isSigner: false,
            isWritable: false,
        },
        ]
    : [
        {
            pubkey: new PublicKey("FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA"),
            isSigner: false,
            isWritable: false,
        },
    ];
    console.log("Validator: ", remainingAccounts[0].pubkey.toString());

    it("Initialize counter on Solana", async () => {
        const start = Date.now();
    
        // 1: InitializeCounter
        // Create, send and confirm transaction
        const tx = new Transaction();
        
        // Get delegation PDAs for Permission
        const delegateBufferPda = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(permissionPda, PERMISSION_PROGRAM_ID);
        const delegationRecordPda = delegationRecordPdaFromDelegatedAccount(permissionPda);
        const delegationMetadataPda = delegationMetadataPdaFromDelegatedAccount(permissionPda);
        
        const keys = [
            // Initializer
            {
                pubkey: userKeypair.publicKey,
                isSigner: true,
                isWritable: true,
            },
            // Counter Account
            {
                pubkey: counterPda,
                isSigner: false,
                isWritable: true,
            },
            // System Program
            {
                pubkey: SystemProgram.programId,
                isSigner: false,
                isWritable: false,
            },
            // Permission Program
            {
                pubkey: PERMISSION_PROGRAM_ID,
                isSigner: false,
                isWritable: false,
            },
            // Permission
            {
                pubkey: permissionPda,
                isSigner: false,
                isWritable: true,
            },
            // Delegation Buffer
            {
                pubkey: delegateBufferPda,
                isSigner: false,
                isWritable: true,
            },
            // Delegation Record
            {
                pubkey: delegationRecordPda,
                isSigner: false,
                isWritable: true,
            },
            // Delegation Metadata
            {
                pubkey: delegationMetadataPda,
                isSigner: false,
                isWritable: true,
            },
            // Delegation Program
            {
                pubkey: DELEGATION_PROGRAM_ID,
                isSigner: false,
                isWritable: false,
            },
            // PER Validator
            ...remainingAccounts
        ]
        const serializedInstructionData =  Buffer.concat([
            Buffer.from(CounterInstruction.InitializeCounter, 'hex'),
            Buffer.from([bump]),
        ])
        const initializeIx = new TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(initializeIx);
        try {
            const txHash = await sendAndConfirmTransaction(connectionBaseLayer, tx, [userKeypair],
                {
                    skipPreflight: true,
                    commitment: "confirmed"
                }
            ); 
            const duration = Date.now() - start;
            console.log(`${duration}ms (Base Layer) Initialize txHash: ${txHash}`);
            expect(txHash).toBeDefined();
        } catch (error: any) {
            console.error("Initialize error:", error);
            throw error;
        }

    }, TEST_TIMEOUT);

    it("Increase counter on Solana", async () => {
        const start = Date.now();

        // 1: IncreaseCounter
        // Create, send and confirm transaction
        const tx = new Transaction();
        const keys = [
            // Initializer
            {
                pubkey: userKeypair.publicKey,
                isSigner: true,
                isWritable: true,
            },
            // Counter Account
            {
                pubkey: counterPda,
                isSigner: false,
                isWritable: true,
            }
        ]
        const serializedInstructionData =  Buffer.concat([
            Buffer.from(CounterInstruction.IncreaseCounter, 'hex'),
            Buffer.from([bump]),
            borsh.serialize(IncreaseCounterPayload.schema, new IncreaseCounterPayload(1))
        ])
        const increaseCounterIx = new TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(increaseCounterIx);
        const txHash = await sendAndConfirmTransaction(connectionBaseLayer, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (Base Layer) Increment txHash: ${txHash}`);
        expect(txHash).toBeDefined();

    }, TEST_TIMEOUT);

    it("Delegate counter to ER", async function () {
        const start = Date.now();

        // 2: Delegate
        // Create, send and confirm transaction
        const tx = new Transaction();
        const keys = [
            // Initializer
            {
                pubkey: userKeypair.publicKey,
                isSigner: true,
                isWritable: true,
            },
            // Counter Account
            {
                pubkey: counterPda,
                isSigner: false,
                isWritable: true,
            },
            // Owner Program
            {
                pubkey: PROGRAM_ID,
                isSigner: false,
                isWritable: false,
            },
            // Delegation Buffer
            {
                pubkey: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(counterPda, PROGRAM_ID),
                isSigner: false,
                isWritable: true,
            },
            // Delegation Record
            {
                pubkey: delegationRecordPdaFromDelegatedAccount(counterPda),
                isSigner: false,
                isWritable: true,
            },
            // Delegation Metadata
            {
                pubkey: delegationMetadataPdaFromDelegatedAccount(counterPda),
                isSigner: false,
                isWritable: true,
            },
            // Delegation Program
            {
                pubkey: DELEGATION_PROGRAM_ID,
                isSigner: false,
                isWritable: false,
            },
            // System Program
            {
                pubkey: SystemProgram.programId,
                isSigner: false,
                isWritable: false,
            },
            // PER Validator
            ...remainingAccounts,
            // Permission account
            {
                pubkey: permissionPda,
                isSigner: false,
                isWritable: false,
            },
            // Permission Program
            {
                pubkey: PERMISSION_PROGRAM_ID,
                isSigner: false,
                isWritable: false,
            }
        ]
        const serializedInstructionData =  Buffer.concat([
            Buffer.from(CounterInstruction.Delegate, 'hex'),
            Buffer.from([bump]),
        ])
        const delegateIx = new TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(delegateIx);
        const txHash = await sendAndConfirmTransaction(connectionBaseLayer, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (Base Layer) Delegate txHash: ${txHash}`);
        expect(txHash).toBeDefined();

    }, TEST_TIMEOUT);

    it("Increase counter on ER (1)", async () => {
        const start = Date.now();

        // 1: IncreaseCounter
        // Create, send and confirm transaction
        const tx = new Transaction();
        const keys = [
            // Initializer
            {
                pubkey: userKeypair.publicKey,
                isSigner: true,
                isWritable: true,
            },
            // Counter Account
            {
                pubkey: counterPda,
                isSigner: false,
                isWritable: true,
            }
        ]
        const serializedInstructionData =  Buffer.concat([
            Buffer.from(CounterInstruction.IncreaseCounter, 'hex'),
            Buffer.from([bump]),
            borsh.serialize(IncreaseCounterPayload.schema, new IncreaseCounterPayload(1))
        ])
        const increaseCounterIx = new TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(increaseCounterIx);
        const txHash = await sendAndConfirmTransaction(connectionEphemeralRollup, tx, [userKeypair], 
            { 
                commitment: "confirmed", 
                skipPreflight: true 
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (ER) Increment txHash: ${txHash}`);
        expect(txHash).toBeDefined();

    }, TEST_TIMEOUT);

    it("Commit counter state on ER to Solana", async () => {
        const start = Date.now();

        // 3: Commit
        // Create, send and confirm transaction
        const tx = new Transaction();
        const keys = [
            // Initializer
            {
                pubkey: userKeypair.publicKey,
                isSigner: true,
                isWritable: true,
            },
            // Counter Account
            {
                pubkey: counterPda,
                isSigner: false,
                isWritable: true,
            },
            // Magic Program
            {
                pubkey: MAGIC_PROGRAM_ID,
                isSigner: false,
                isWritable: false,
            },
            // Magic Context
            {
                pubkey: MAGIC_CONTEXT_ID,
                isSigner: false,
                isWritable: true,
            }
        ]
        const serializedInstructionData =  Buffer.from(CounterInstruction.Commit, 'hex')
        const commitIx = new TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(commitIx);
        const txHash = await sendAndConfirmTransaction(connectionEphemeralRollup, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (ER) Commit txHash: ${txHash}`);
        expect(txHash).toBeDefined();

    }, TEST_TIMEOUT);

    it("Increase counter on ER (2)", async () => {

        const start = Date.now();

        // 1: IncreaseCounter
        // Create, send and confirm transaction
        const tx = new Transaction();
        const keys = [
            // Initializer
            {
                pubkey: userKeypair.publicKey,
                isSigner: true,
                isWritable: true,
            },
            // Counter Account
            {
                pubkey: counterPda,
                isSigner: false,
                isWritable: true,
            }
        ]
        const serializedInstructionData =  Buffer.concat([
            Buffer.from(CounterInstruction.IncreaseCounter, 'hex'),
            Buffer.from([bump]),
            borsh.serialize(IncreaseCounterPayload.schema, new IncreaseCounterPayload(1))
        ])
        const initializeIx = new TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(initializeIx);
        const txHash = await sendAndConfirmTransaction(connectionEphemeralRollup, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (ER) Increment txHash: ${txHash}`);
        expect(txHash).toBeDefined();

    }, TEST_TIMEOUT);

    it("Commit and undelegate counter on ER to Solana", async function () {

        const start = Date.now();

        // 3: CommitAndUndelegate
        // Create, send and confirm transaction
        const tx = new Transaction();
        const keys = [
            // Initializer
            {
                pubkey: userKeypair.publicKey,
                isSigner: true,
                isWritable: true,
            },
            // Counter Account
            {
                pubkey: counterPda,
                isSigner: false,
                isWritable: true,
            },
            // Permission
            {
                pubkey: permissionPda,
                isSigner: false,
                isWritable: true,
            },
            // Magic Program
            {
                pubkey: MAGIC_PROGRAM_ID,
                isSigner: false,
                isWritable: false,
            },
            // Magic Context
            {
                pubkey: MAGIC_CONTEXT_ID,
                isSigner: false,
                isWritable: true,
            }
        ]
        const serializedInstructionData =  Buffer.from(CounterInstruction.CommitAndUndelegate, 'hex')
        const undelegateIx = new TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(undelegateIx);
        const txHash = await sendAndConfirmTransaction(connectionEphemeralRollup, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (ER) Undelegate txHash: ${txHash}`);
        expect(txHash).toBeDefined();

    }, TEST_TIMEOUT);
});
