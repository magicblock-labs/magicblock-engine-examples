import * as web3 from "@solana/web3.js";
import { initializeSolSignerKeypair, airdropSolIfNeeded } from "./initializeKeypair";  // Import the functions
import * as borsh from "borsh";
import * as fs from "fs";
import { expect } from "chai"; // Use expect for assertions
import { Suite } from 'mocha'; 
import { Counter, CounterInstruction, CounterSchema, IncreaseCounterPayload } from "./schema";
import { DELEGATION_PROGRAM_ID, delegationRecordPdaFromDelegatedAccount, delegationMetadataPdaFromDelegatedAccount, delegateBufferPdaFromDelegatedAccountAndOwnerProgram, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";

import dotenv from 'dotenv'
dotenv.config()

describe("Running tests:", async function (this: Suite) {
    this.timeout(60000);  // Set timeout for the test
  
    // Get programId from target folder
    const keypairPath = "target/deploy/rust_counter-keypair.json";
    const secretKeyArray = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")));
    const keypair = web3.Keypair.fromSecretKey(secretKeyArray);
    const PROGRAM_ID = keypair.publicKey;
  
    // Set up a connection to blockchain cluster
    const connectionBaseLayer = new web3.Connection("https://api.devnet.solana.com", {wsEndpoint: "wss://api.devnet.solana.com"});
    const connectionEphemeralRollup = new web3.Connection(process.env.PROVIDER_ENDPOINT || "https://devnet.magicblock.app/", {wsEndpoint: process.env.WS_ENDPOINT || "wss://devnet.magicblock.app/"});
    console.log("Base Layer Connection: ", connectionBaseLayer._rpcEndpoint);
    console.log("Ephemeral Rollup Connection: ", connectionEphemeralRollup._rpcEndpoint);
  
    // Create user keypair and airdrop SOL if needed
    const userKeypair = initializeSolSignerKeypair();  // Use the keypair management function
  
    // Run this once before all tests
    before(async function () {
        await airdropSolIfNeeded(connectionBaseLayer, userKeypair.publicKey, 2, 0.05);
    });
  
    // Get pda of counter_account
    let [counterPda, bump] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("counter_account"), userKeypair.publicKey.toBuffer()],
        PROGRAM_ID
    );
    console.log("Program ID: ", PROGRAM_ID.toString())
    console.log("Counter PDA: ", counterPda.toString())

    it("Initialize counter on Solana", async function () {
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
            Buffer.from(CounterInstruction.InitializeCounter, 'hex'),
        ])
        const initializeIx = new web3.TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(initializeIx);
        const txHash = await web3.sendAndConfirmTransaction(connectionBaseLayer, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (Base Layer) Initialize txHash: ${txHash}`);

    });
    it("Increase counter on Solana", async function () {
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
        const txHash = await web3.sendAndConfirmTransaction(connectionBaseLayer, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (Base Layer) Increment txHash: ${txHash}`);

    });
    it("Delegate counter to ER", async function () {
        const start = Date.now();

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
        const txHash = await web3.sendAndConfirmTransaction(connectionBaseLayer, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (Base Layer) Delegate txHash: ${txHash}`);

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
        const txHash = await web3.sendAndConfirmTransaction(connectionEphemeralRollup, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (ER) Increment txHash: ${txHash}`);

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
        const txHash = await web3.sendAndConfirmTransaction(connectionEphemeralRollup, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (ER) Commit txHash: ${txHash}`);

        // Get the commitment signature on the base layer
        const comfirmCommitStart = Date.now();
        // Await for the commitment on the base layer
        const txCommitSgn = await GetCommitmentSignature(
            txHash,
            connectionEphemeralRollup
        );
        const commitDuration = Date.now() - comfirmCommitStart;
        console.log(`${commitDuration}ms (Base Layer) Commit txHash: ${txCommitSgn}`);
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
        const txHash = await web3.sendAndConfirmTransaction(connectionEphemeralRollup, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (ER) Increment txHash: ${txHash}`);

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
        const txHash = await web3.sendAndConfirmTransaction(connectionEphemeralRollup, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (ER) Undelegate txHash: ${txHash}`);



        // Get the commitment signature on the base layer
        const comfirmCommitStart = Date.now();
        // Await for the commitment on the base layer
        const txCommitSgn = await GetCommitmentSignature(
            txHash,
            connectionEphemeralRollup
        );
        const commitDuration = Date.now() - comfirmCommitStart;
        console.log(`${commitDuration}ms (Base Layer) Undelegate txHash: ${txCommitSgn}`);
});
  });

describe("rust-counter-increment-commit-atomic", () => {

    // Get programId from target folder
    const keypairPath = "target/deploy/rust_counter-keypair.json";
    const secretKeyArray = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")));
    const keypair = web3.Keypair.fromSecretKey(secretKeyArray);
    const PROGRAM_ID = keypair.publicKey;


    // Set up a connection to blockchain cluster
    const connectionBaseLayer = new web3.Connection("https://api.devnet.solana.com", {wsEndpoint: "wss://api.devnet.solana.com"});
    const connectionEphemeralRollup = new web3.Connection(process.env.PROVIDER_ENDPOINT || "https://devnet.magicblock.app/", {wsEndpoint: process.env.WS_ENDPOINT || "wss://devnet.magicblock.app/"});
    
    // Create user keypair and airdrop SOL if needed
    const userKeypair = initializeSolSignerKeypair();  // Use the keypair management function

    // Run this once before all tests
    before(async function () {
        await airdropSolIfNeeded(connectionBaseLayer, userKeypair.publicKey, 2, 0.05);
    });
  
    // Get pda of counter_account
    let [counterPda, bump] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("counter_account"), userKeypair.publicKey.toBuffer()],
        PROGRAM_ID
    );
  
    it("Initialize counter on Solana", async function () {
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
            Buffer.from(CounterInstruction.InitializeCounter, 'hex'),
        ])
        const initializeIx = new web3.TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(initializeIx);
        const txHash = await web3.sendAndConfirmTransaction(connectionBaseLayer, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (Base Layer) Initialize txHash: ${txHash}`);

    });
  
    it("Delegate counter to ER", async function () {
        const start = Date.now();

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
        const txHash = await web3.sendAndConfirmTransaction(connectionBaseLayer, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (Base Layer) Delegate txHash: ${txHash}`);

    });
  
    it("Increase the delegate counter and commit through CPI", async function () {
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
        const serializedInstructionData =  Buffer.concat([
            Buffer.from(CounterInstruction.IncrementAndCommit, 'hex'),
            borsh.serialize(IncreaseCounterPayload.schema, new IncreaseCounterPayload(1))
        ])
        const IncrementAndCommitIx = new web3.TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(IncrementAndCommitIx);
        const txHash = await web3.sendAndConfirmTransaction(connectionEphemeralRollup, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (ER) Increment And Commit txHash: ${txHash}`);
    
        // Await for the commitment on the base layer
        const txCommitSgn = await GetCommitmentSignature(
          txHash,
          connectionEphemeralRollup
        );
        console.log("Account commit signature:", txCommitSgn);

    });
  
    it("Increase the delegate counter and undelegate through CPI", async function () {
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
        const serializedInstructionData =  Buffer.concat([
            Buffer.from(CounterInstruction.IncreamentAndUndelegate, 'hex'),
            borsh.serialize(IncreaseCounterPayload.schema, new IncreaseCounterPayload(1))
        ])
        const IncreamentAndUndelegateIx = new web3.TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(IncreamentAndUndelegateIx);
        const txHash = await web3.sendAndConfirmTransaction(connectionEphemeralRollup, tx, [userKeypair],
            {
                skipPreflight: true,
                commitment: "confirmed"
            }
        ); 
        const duration = Date.now() - start;
        console.log(`${duration}ms (ER) Increment and Undelegate txHash: ${txHash}`);
    
        // Get the undelegate signature on the base layer
        const comfirmCommitStart = Date.now();
        // Await for the commitment on the base layer
        const txCommitSgn = await GetCommitmentSignature(
            txHash,
            connectionEphemeralRollup
        );
        const commitDuration = Date.now() - comfirmCommitStart;
        console.log(`${commitDuration}ms (Base Layer) Undelegate txHash: ${txCommitSgn}`);

    });
  
});
  