import * as web3 from "@solana/web3.js";
import { initializeSolSignerKeypair, airdropSolIfNeeded } from "./initializeKeypair";  // Import the functions
import * as borsh from "borsh";
import * as fs from "fs";
import { expect } from "chai"; // Use expect for assertions
import { Suite } from 'mocha'; 
import { Counter, CounterInstruction, CounterSchema, IncreaseCounterPayload } from "./schema";

import dotenv from 'dotenv'
import { DELEGATION_PROGRAM_ID, getDelegationBufferPda, getDelegationMetadataPda, getDelegationRecordPda, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID } from "./constants";
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

    it("Initialize counter on Solana", async function () {

        // Check counter account ownership, skip test if delegated
        const isDelegated = (await (new web3.Connection(rpcSolana)).getAccountInfo(counterPda))?.owner.toString() == DELEGATION_PROGRAM_ID.toString();
        if (isDelegated){
            console.log("Counter is delegated: Test skipped")
            this.skip()
        }

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

        // Fetch counter account on Solana, deserialize data, and check value
        const counterAccount = await (new web3.Connection(rpcSolana, { commitment: "processed" })
        ).getAccountInfo(counterPda);
        const deserializedAccountData = borsh.deserialize(
            CounterSchema,
            Counter,
            counterAccount!.data
        );
        console.log(`${counterPda}: ${deserializedAccountData.count} (Solana)`);
        expect(Number(deserializedAccountData.count)).to.be.at.least(0, "The counter value should be 0");
    });

    it("Increase counter on Solana", async function () {

        // Check counter account ownership, skip test if delegated
        const isDelegated = (await (new web3.Connection(rpcSolana)).getAccountInfo(counterPda))?.owner.toString() == DELEGATION_PROGRAM_ID.toString();
        if (isDelegated){
            console.log("Counter is delegated: Test skipped")
            this.skip()
        }

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

        // Fetch counter account on Solana, deserialize data, and check value
        const counterAccount = await (new web3.Connection(rpcSolana, { commitment: "processed" })
        ).getAccountInfo(counterPda);
        const deserializedAccountData = borsh.deserialize(
            CounterSchema,
            Counter,
            counterAccount!.data
        );
        console.log(`${counterPda}: ${deserializedAccountData.count} (Solana)`);
        expect(Number(deserializedAccountData.count)).to.be.at.least(1, "The counter value should be 1 or greater");
    });
    it("Delegate counter to ER", async function () {

        // Check counter account ownership, skip test if delegated
        const isDelegated = (await (new web3.Connection(rpcSolana)).getAccountInfo(counterPda))?.owner.toString() == DELEGATION_PROGRAM_ID.toString();
        if (isDelegated){
            console.log("Counter is delegated: Test skipped")
            this.skip()
        }

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
                pubkey: getDelegationBufferPda(counterPda, PROGRAM_ID),
                isSigner: false,
                isWritable: true,
            },
            // Delegation Record
            {
                pubkey: getDelegationRecordPda(counterPda),
                isSigner: false,
                isWritable: true,
            },
            // Delegation Metadata
            {
                pubkey: getDelegationMetadataPda(counterPda),
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

        // Fetch counter account on Solana and check owner
        const counterAccount = await (new web3.Connection(rpcSolana, { commitment: "processed" })).getAccountInfo(counterPda);
        const owner = counterAccount.owner.toString()
        console.log(`PDA Owner: ${owner} (Solana)`);
        expect(owner).equals(DELEGATION_PROGRAM_ID.toString(), "The counter should be owned by Delegation Program");

    });
    it("Increase counter on ER", async function () {

        // Check counter account ownership, skip test if NOT delegated
        const isDelegated = (await (new web3.Connection(rpcSolana)).getAccountInfo(counterPda))?.owner.toString() == DELEGATION_PROGRAM_ID.toString();
        if (!isDelegated){
            console.log("Counter is NOT delegated: Test skipped")
            this.skip()
        }

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

        // Fetch counter account on Solana, deserialize data, and check value
        const counterAccount = await (new web3.Connection(rpcMagicblock, { commitment: "processed" })
        ).getAccountInfo(counterPda);
        const deserializedAccountData = borsh.deserialize(
            CounterSchema,
            Counter,
            counterAccount!.data
        );
        console.log(`PDA ${counterPda}: ${deserializedAccountData.count} (ER)`);
        expect(Number(deserializedAccountData.count)).to.be.at.least(1, "The counter value should be 1 or greater");

    });
    it("Commit and undelegate counter on ER to Solana", async function () {

        // Check counter account ownership, skip test if NOT delegated
        const isDelegated = (await (new web3.Connection(rpcSolana)).getAccountInfo(counterPda))?.owner.toString() == DELEGATION_PROGRAM_ID.toString();
        if (!isDelegated){
            console.log("Counter is NOT delegated: Test skipped")
            this.skip()
        } 

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

        // Fetch counter account on Solana (to check owner)
        const counterAccount = await (new web3.Connection(rpcSolana, { commitment: "processed" })).getAccountInfo(counterPda);
        const owner = counterAccount.owner.toString()
        console.log(`PDA Owner: ${owner} (Solana)`);
        expect(owner).not.equals(DELEGATION_PROGRAM_ID.toString(), "The counter should NOT be owned by Delegation Program");

    });
  });