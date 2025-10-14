import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, Connection, sendAndConfirmTransaction } from "@solana/web3.js";
import { initializeSolSignerKeypair, airdropSolIfNeeded } from "./initializeKeypair"; 
import * as borsh from "borsh";
import * as fs from "fs";
import { CounterInstruction, IncreaseCounterPayload } from "./schema";
import { DELEGATION_PROGRAM_ID, delegationRecordPdaFromDelegatedAccount, delegationMetadataPdaFromDelegatedAccount, delegateBufferPdaFromDelegatedAccountAndOwnerProgram, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, GetCommitmentSignature
 } from "@magicblock-labs/ephemeral-rollups-sdk";

import dotenv from 'dotenv'
dotenv.config()



describe("basic-test", async function () {
    this.timeout(60000);  // Set timeout for the test
    console.log("rust-counter.ts")

    // Get programId from target folder
    const keypairPath = "target/deploy/rust_counter-keypair.json";
    const secretKeyArray = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")));
    const keypair = Keypair.fromSecretKey(secretKeyArray);
    const PROGRAM_ID = keypair.publicKey;
  
    // Set up a connection to blockchain cluster
    const connectionBaseLayer = new Connection(process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com", {wsEndpoint:process.env.WS_ENDPOINT || "wss://api.devnet.solana.com"});
    const connectionEphemeralRollup = new Connection(process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app/", {wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app/"});
    console.log("Base Layer Connection: ", connectionBaseLayer.rpcEndpoint);
    console.log("Ephemeral Rollup Connection: ", connectionEphemeralRollup.rpcEndpoint);


  
    // Create user keypair and airdrop SOL if needed
    const userKeypair = initializeSolSignerKeypair();  // Use the keypair management function
  
    // Run this once before all tests
    before(async function () {
        await airdropSolIfNeeded(connectionBaseLayer, userKeypair.publicKey, 2, 0.05);
    });
  
    // Get pda of counter_account
    let [counterPda, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("counter_account"), userKeypair.publicKey.toBuffer()],
        PROGRAM_ID
    );
    console.log("Program ID: ", PROGRAM_ID.toString())
    console.log("Counter PDA: ", counterPda.toString())

    it("Initialize counter on Solana", async function () {
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
            },
            // System Program
            {
                pubkey: SystemProgram.programId,
                isSigner: false,
                isWritable: false,
            }
        ]
        const serializedInstructionData =  Buffer.concat([
            Buffer.from(CounterInstruction.InitializeCounter, 'hex'),
        ])
        const initializeIx = new TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(initializeIx);
        const txHash = await sendAndConfirmTransaction(connectionBaseLayer, tx, [userKeypair],
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

    });
    it("Delegate counter to ER", async function () {
        const start = Date.now();

        // Add local validator identity to the remaining accounts if running on localnet
        const remainingAccounts =
        connectionEphemeralRollup.rpcEndpoint.includes("localhost") ||
        connectionEphemeralRollup.rpcEndpoint.includes("127.0.0.1")
            ? [
                {
                pubkey: new PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
                isSigner: false,
                isWritable: false,
                },
            ]
        : [];

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
            // System Program
            {
                pubkey: SystemProgram.programId,
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
            // ER Validator
            ...remainingAccounts
        ]
        const serializedInstructionData =  Buffer.from(CounterInstruction.Delegate, 'hex')
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

    });
    it("Increase counter on ER (1)", async function () {
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

    });
    it("Commit counter state on ER to Solana", async function () {
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

        // Get the commitment signature on the base layer
        const comfirmCommitStart = Date.now();
        // Await for the commitment on the base layer
        const txCommitSgn = await GetCommitmentSignature(
            txHash,
            // tx,
            connectionEphemeralRollup
        );
        const commitDuration = Date.now() - comfirmCommitStart;
        console.log(`${commitDuration}ms (Base Layer) Commit txHash: ${txCommitSgn}`);
    });
    it("Increase counter on ER (2)", async function () {

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

    });
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

        // Get the commitment signature on the base layer
        const comfirmCommitStart = Date.now();
        // Await for the commitment on the base layer
        const txCommitSgn = await GetCommitmentSignature(
            txHash,
            // tx,
            connectionEphemeralRollup
        );
        const commitDuration = Date.now() - comfirmCommitStart;
        console.log(`${commitDuration}ms (Base Layer) Undelegate txHash: ${txCommitSgn}`);

    });
});