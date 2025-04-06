import * as web3 from "@solana/web3.js";
import { initializeSolSignerKeypair, airdropSolIfNeeded } from "./initializeKeypair";  // Import the functions
import * as borsh from "borsh";
import * as fs from "fs";
import { expect } from "chai"; // Use expect for assertions
import { Suite } from 'mocha'; 
import { Counter, CounterInstruction, CounterSchema, IncreaseCounterPayload } from "./schema";
import { DELEGATION_PROGRAM_ID, delegationRecordPdaFromDelegatedAccount, delegationMetadataPdaFromDelegatedAccount, delegateBufferPdaFromDelegatedAccountAndOwnerProgram, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";

import dotenv from 'dotenv'
dotenv.config()

describe("Running tests:", async function (this: Suite) {
    this.timeout(60000);  // Set timeout for the test
  
    // Get programId from target folder
    const keypairPath = "target/deploy/rust_counter-keypair.json";
    const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")));
    const keypair = web3.Keypair.fromSecretKey(secretKey);
    const PROGRAM_ID = keypair.publicKey;
  
    // Set up a connection to blockchain cluster
    const rpcSolana = process.env.RPC_SOLANA as string
    const rpcMagicblock = process.env.RPC_MAGICBLOCK as string
  
    // Create user keypair and airdrop SOL if needed
    const userKeypair = initializeSolSignerKeypair();  // Use the keypair management function
  
    // Run this once before all tests
    before(async function () {
        const connection = new web3.Connection(rpcSolana);
        await airdropSolIfNeeded(connection, userKeypair.publicKey, 2, 0.05);
    });
  
    // Get pda of counter_account
    let [counterPda, bump] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("counter_account"), userKeypair.publicKey.toBuffer()],
        PROGRAM_ID
     );
     console.log("Program ID: ", PROGRAM_ID.toString())
    console.log("Counter PDA: ", counterPda.toString())

    it("Initialize counter on Solana", async function () {

        // 1: IncreaseCounter
        // Create, send and confirm transaction
        const tx = new web3.Transaction();
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
                pubkey: web3.SystemProgram.programId,
                isSigner: false,
                isWritable: false,
            }
        ]
        const serializedInstructionData =  Buffer.concat([
            Buffer.from(CounterInstruction.InitializeCounter, 'hex'),
        ])
        const initializeIx = new web3.TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(initializeIx);
        const connection = new web3.Connection(rpcSolana)
        const txHash = await web3.sendAndConfirmTransaction(connection, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        console.log("txId:", txHash)

    });

    it("Increase counter on Solana", async function () {

        // 1: IncreaseCounter
        // Create, send and confirm transaction
        const tx = new web3.Transaction();
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
                pubkey: web3.SystemProgram.programId,
                isSigner: false,
                isWritable: false,
            }
        ]
        const serializedInstructionData =  Buffer.concat([
            Buffer.from(CounterInstruction.IncreaseCounter, 'hex'),
            borsh.serialize(IncreaseCounterPayload.schema, new IncreaseCounterPayload(1))
        ])
        const increaseCounterIx = new web3.TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(increaseCounterIx);
        const connection = new web3.Connection(rpcSolana)
        const txHash = await web3.sendAndConfirmTransaction(connection, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        console.log("txId:", txHash)

    });
    it("Delegate counter to ER", async function () {

        // 2: Delegate
        // Create, send and confirm transaction
        const tx = new web3.Transaction();
        const keys = [
            // Initializer
            {
                pubkey: userKeypair.publicKey,
                isSigner: true,
                isWritable: true,
            },
            // System Program
            {
                pubkey: web3.SystemProgram.programId,
                isSigner: false,
                isWritable: false,
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
        ]
        const serializedInstructionData =  Buffer.from(CounterInstruction.Delegate, 'hex')
        const delegateIx = new web3.TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(delegateIx);
        const connection = new web3.Connection(rpcSolana);
        const txHash = await web3.sendAndConfirmTransaction(connection, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        console.log("txId:", txHash)

    });
    it("Increase counter on ER (1)", async function () {
        const start = Date.now();

        // 1: IncreaseCounter
        // Create, send and confirm transaction
        const tx = new web3.Transaction();
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
                pubkey: web3.SystemProgram.programId,
                isSigner: false,
                isWritable: false,
            }
        ]
        const serializedInstructionData =  Buffer.concat([
            Buffer.from(CounterInstruction.IncreaseCounter, 'hex'),
            borsh.serialize(IncreaseCounterPayload.schema, new IncreaseCounterPayload(1))
        ])
        const initializeIx = new web3.TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(initializeIx);
        const connection = new web3.Connection(rpcMagicblock);
        const txHash = await web3.sendAndConfirmTransaction(connection, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        console.log("txId:", txHash)

        const duration = Date.now() - start;
        console.log(`(${duration}ms)`);

    });
    it("Commit counter state on ER to Solana", async function () {
        const start = Date.now();

        // 3: Commit
        // Create, send and confirm transaction
        const tx = new web3.Transaction();
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
        const commitIx = new web3.TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(commitIx);
        const connection = new web3.Connection(rpcMagicblock);
        const txHash = await web3.sendAndConfirmTransaction(connection, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        console.log("txId:", txHash)

        const duration = Date.now() - start;
        console.log(`(${duration}ms)`);

    });
    it("Increase counter on ER (2)", async function () {

        const start = Date.now();

        // 1: IncreaseCounter
        // Create, send and confirm transaction
        const tx = new web3.Transaction();
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
                pubkey: web3.SystemProgram.programId,
                isSigner: false,
                isWritable: false,
            }
        ]
        const serializedInstructionData =  Buffer.concat([
            Buffer.from(CounterInstruction.IncreaseCounter, 'hex'),
            borsh.serialize(IncreaseCounterPayload.schema, new IncreaseCounterPayload(1))
        ])
        const initializeIx = new web3.TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(initializeIx);
        const connection = new web3.Connection(rpcMagicblock);
        const txHash = await web3.sendAndConfirmTransaction(connection, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        console.log("txId:", txHash)

        const duration = Date.now() - start;
        console.log(`(${duration}ms)`);

    });
    it("Commit and undelegate counter on ER to Solana", async function () {

        const start = Date.now();

        // 3: CommitAndUndelegate
        // Create, send and confirm transaction
        const tx = new web3.Transaction();
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
        const serializedInstructionData =  Buffer.from(CounterInstruction.CommitAndUndelegate, 'hex')
        const undelegateIx = new web3.TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(undelegateIx);
        const connection = new web3.Connection(rpcMagicblock);
        const txHash = await web3.sendAndConfirmTransaction(connection, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        console.log("txId:", txHash)

        const duration = Date.now() - start;
        console.log(`(${duration}ms)`);
    });
  });