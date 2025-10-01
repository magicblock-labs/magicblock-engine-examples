import { sendAndConfirmTransaction, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { initializeSolSignerKeypair, airdropSolIfNeeded } from "./initializeKeypair";  // Import the functions
import * as borsh from "borsh";
import * as fs from "fs";
import { Suite } from 'mocha'; 
import { CounterInstruction, IncreaseCounterPayload } from "./schema";
import { DELEGATION_PROGRAM_ID, delegationRecordPdaFromDelegatedAccount, delegationMetadataPdaFromDelegatedAccount, delegateBufferPdaFromDelegatedAccountAndOwnerProgram, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, GetCommitmentSignature, getLatestBlockhashForMagicTransaction, getClosestValidator
 } from "@magicblock-labs/ephemeral-rollups-sdk";

import dotenv from 'dotenv'
import { error } from "console";
dotenv.config()

describe.only("magic-router-test", () => {

    // Get programId from target folder
    const keypairPath = "target/deploy/rust_counter-keypair.json";
    const secretKeyArray = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")));
    const keypair = Keypair.fromSecretKey(secretKeyArray);
    const PROGRAM_ID = keypair.publicKey;

    // Set up a connection to blockchain cluster
    const connection = new Connection(
        process.env.PROVIDER_ENDPOINT 
        || 
        "https://devnet-router.magicblock.app"
        , {
            wsEndpoint:
            process.env.WS_ENDPOINT 
            || 
            "wss://devnet-router.magicblock.app"
        });
    
    // Create user keypair and airdrop SOL if needed
    const userKeypair = initializeSolSignerKeypair();  // Use the keypair management function

    // Run this once before all tests
    before(async function () {
        console.log("Endpoint:", connection._rpcEndpoint.toString());
        console.log("Detected validator identity:", (await getClosestValidator(connection)).toString());
        await airdropSolIfNeeded(connection, userKeypair.publicKey, 2, 0.05);
    });


  
    // Get pda of counter_account
    let [counterPda, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("counter_account"), userKeypair.publicKey.toBuffer()],
        PROGRAM_ID
    );
  
    it("Initialize counter on Solana", async function () {
        const start = Date.now();

        // 1: IncreaseCounter
        // Create, send and confirm transaction
        let tx = new Transaction();
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
        const txHash = await sendAndConfirmMagicTransaction(connection, tx, [userKeypair],
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
        let tx = new Transaction();
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
        ]
        const serializedInstructionData =  Buffer.from(CounterInstruction.Delegate, 'hex')
        const delegateIx = new TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(delegateIx);
        const txHash = await sendAndConfirmMagicTransaction(connection, tx, [userKeypair],
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
        let tx = new Transaction();
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
        const IncrementAndCommitIx = new TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(IncrementAndCommitIx);
        const txHash = await sendAndConfirmMagicTransaction(connection, tx, [userKeypair],
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
          connection
        );
        console.log("Account commit signature:", txCommitSgn);

    });
  
    it("Increase the delegate counter and undelegate through CPI", async function () {

        const start = Date.now();

        // 1: IncreaseCounter
        // Create, send and confirm transaction
        let tx = new Transaction();
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
        const IncreamentAndUndelegateIx = new TransactionInstruction({
            keys: keys,
            programId: PROGRAM_ID,
            data: serializedInstructionData
        });
        tx.add(IncreamentAndUndelegateIx);
        const txHash = await sendAndConfirmMagicTransaction(connection, tx, [userKeypair],
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
            connection
        );
        const commitDuration = Date.now() - comfirmCommitStart;
        console.log(`${commitDuration}ms (Base Layer) Undelegate txHash: ${txCommitSgn}`);

    });
  
});



const sendAndConfirmMagicTransaction = async (
    connection: Connection,
    transaction: Transaction,
    signers: Keypair[],
    options?: {
      skipPreflight?: boolean;
      commitment?: "processed" | "confirmed" | "finalized";
    }
  ): Promise<string> => {

    const latestBlockhash = await getLatestBlockhashForMagicTransaction(connection, transaction, options)
    console.log("latestBlockhash:", latestBlockhash);


    const devcon = new Connection("https://devnet.helius-rpc.com/?api-key=d361db0b-e072-43fd-908f-5f81baf9226a");
    const latestBlockhashDevcon = await devcon.getLatestBlockhash("finalized");
    console.log("latestBlockhashDevcon:", latestBlockhashDevcon);


    transaction.lastValidBlockHeight = latestBlockhashDevcon.lastValidBlockHeight;
    transaction.recentBlockhash = latestBlockhashDevcon.blockhash;

    const txHash = await sendAndConfirmTransaction(
      connection,
      transaction,
      signers,
      options
    );
    return txHash;
  }     