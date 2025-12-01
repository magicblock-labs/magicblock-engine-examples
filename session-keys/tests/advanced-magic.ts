import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { AnchorCounterSession } from "../target/types/anchor_counter_session";
import { LAMPORTS_PER_SOL, sendAndConfirmTransaction } from "@solana/web3.js";
import {
    ConnectionMagicRouter, GetCommitmentSignature
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { initializeSessionSignerKeypair } from "../utils/initializeKeypair";


const COUNTER_SEED = "counter";

describe("magic-router-counter-session", () => {
    console.log("advanced-magic.ts")
    
    const connection = new ConnectionMagicRouter(
        process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-router.magicblock.app/", 
        {
          wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-router.magicblock.app/"
        }
    )
    const providerMagic = new anchor.AnchorProvider(connection, anchor.Wallet.local());

    const program = anchor.workspace.AnchorCounterSession as Program<AnchorCounterSession>;
    const [counterPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(COUNTER_SEED), providerMagic.wallet.publicKey.toBuffer()],
        program.programId,
    );
    
    console.log("Program ID: ", program.programId.toString())
    console.log("Counter PDA: ", counterPDA.toString())

    // Initialize Session Manager
    const sessionKeypair = initializeSessionSignerKeypair();
    const sessionTokenManager = new SessionTokenManager(providerMagic.wallet, connection);
    const SESSION_TOKEN_SEED = "session_token";
    const sessionTokenPDA = web3.PublicKey.findProgramAddressSync([
        Buffer.from(SESSION_TOKEN_SEED),
        program.programId.toBytes(),
        sessionKeypair.publicKey.toBytes(),
        providerMagic.wallet.publicKey.toBytes(),
    ], sessionTokenManager.program.programId)[0];
    
    console.log("Session Signer Public Key: ", sessionKeypair.publicKey.toString());
    console.log("Session Token PDA: ", sessionTokenPDA.toString());

    // Run this once before all tests
    let ephemeralValidator;
    before(async function () {
        console.log("Endpoint:", connection.rpcEndpoint.toString());
        ephemeralValidator = await connection.getClosestValidator();
        console.log("Detected validator identity:", ephemeralValidator);
        const balance = await connection.getBalance(anchor.Wallet.local().publicKey)
        console.log('Current balance is', balance / LAMPORTS_PER_SOL, ' SOL', '\n')
    })

    it("Create session on Magic Router", async () => {
        const start = Date.now();

        const topUp = true
        const validUntilBN = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // valid for 1 hour
        const topUpLamportsBN = new anchor.BN(0.0005 * LAMPORTS_PER_SOL);

        const tx = await sessionTokenManager.program.methods.createSession(
            topUp, 
            validUntilBN, 
            topUpLamportsBN
        )
        .accounts({
            targetProgram: program.programId,
            sessionSigner: sessionKeypair.publicKey,
            authority: providerMagic.wallet.publicKey,
        })
        .transaction();

        const txHash = await sendAndConfirmTransaction(connection, tx, [sessionKeypair, providerMagic.wallet.payer], {
            skipPreflight: true,
            commitment: "confirmed",
        });
        const duration = Date.now() - start;
        console.log(`${duration}ms (Magic Router) CreateSession txHash: ${txHash}`);
    });

    it("Initialize counter via Magic Router", async () => {
        const start = Date.now();
        let tx = await program.methods
            .initialize()
            .accounts({
                user: providerMagic.wallet.publicKey,
            })
            .transaction();
        const txHash = await sendAndConfirmTransaction(connection, tx, [providerMagic.wallet.payer], {
            skipPreflight: true,
            commitment: "confirmed"
        });
        const duration = Date.now() - start;
        console.log(`${duration}ms (Magic Router) Initialize txHash: ${txHash}`);
    });

    it("Delegate counter to ER", async () => {
        const start = Date.now();

        const validator = (await connection.getClosestValidator());
        console.log("Delegating to closest validator: ", JSON.stringify(validator));

        // Add local validator identity to the remaining accounts if running on localnet
        const remainingAccounts =
            connection.rpcEndpoint.includes("localhost") ||
            connection.rpcEndpoint.includes("127.0.0.1")
                ? [
                    {
                        pubkey: new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
                        isSigner: false,
                        isWritable: false,
                    },
                ]
                : [
                    {
                        pubkey: new web3.PublicKey(validator.identity),
                        isSigner: false,
                        isWritable: false,
                    },
                ];

        let tx = await program.methods
            .delegate()
            .accounts({
                payer: providerMagic.wallet.publicKey,
                pda: counterPDA,
            })
            .remainingAccounts(remainingAccounts)
            .transaction();
        const txHash = await sendAndConfirmTransaction(connection, tx, [providerMagic.wallet.payer], {
            skipPreflight: true,
            commitment: "confirmed"
        });
        const duration = Date.now() - start;
        console.log(`${duration}ms (Magic Router) Delegate txHash: ${txHash}`);
    });

    it("Increase delegated counter on ER", async () => {
        const start = Date.now();
        let tx = await program.methods
            .increment()
            .accounts({
                counter: counterPDA,
                sessionToken: sessionTokenPDA,
                signer: sessionKeypair.publicKey,
            })
            .transaction();
        const txHash = await sendAndConfirmTransaction(connection, tx, [sessionKeypair], {
            skipPreflight: true,
            commitment: "confirmed"
        });
        const duration = Date.now() - start;
        console.log(`${duration}ms (ER) Increment txHash: ${txHash}`);
    });

    it("Increase delegated counter and commit through CPI", async () => {
        const start = Date.now();
        let tx = await program.methods
            .incrementAndCommit()
            .accounts({
                counter: counterPDA,
                sessionToken: sessionTokenPDA,
                signer: sessionKeypair.publicKey,
                payer: sessionKeypair.publicKey
            })
            .transaction();
        const txHash = await sendAndConfirmTransaction(connection, tx, [sessionKeypair], {
            skipPreflight: true,
        });
        const duration = Date.now() - start;
        console.log(`${duration}ms (ER) Increment And Commit txHash: ${txHash}`);

        // Get the commitment signature on the base layer
        const comfirmCommitStart = Date.now();
        // Await for the commitment on the base layer
        const txCommitSgn = await GetCommitmentSignature(
            txHash,
            new anchor.web3.Connection(ephemeralValidator.fqdn),
        );
        const commitDuration = Date.now() - comfirmCommitStart;
        console.log(
            `${commitDuration}ms (Base Layer) Commit txHash: ${txCommitSgn}`,
        );
    });

    it("Increase delegated counter and undelegate through CPI", async () => {
        const start = Date.now();
        let tx = await program.methods
            .incrementAndUndelegate()
            .accounts({
                counter: counterPDA,
                sessionToken: sessionTokenPDA,
                signer: sessionKeypair.publicKey,
                payer: sessionKeypair.publicKey
            })
            .transaction();
        const txHash = await sendAndConfirmTransaction(connection, tx, [sessionKeypair], {
            skipPreflight: true,
        });
        const duration = Date.now() - start;
        console.log(
            `${duration}ms (ER) Increment and Undelegate txHash: ${txHash}`,
        );

        // Get the undelegate signature on the base layer
        const comfirmCommitStart = Date.now();
        // Await for the commitment on the base layer
        const txCommitSgn = await GetCommitmentSignature(
            txHash,
            new anchor.web3.Connection(ephemeralValidator.fqdn),
        );
        const commitDuration = Date.now() - comfirmCommitStart;
        console.log(
            `${commitDuration}ms (Base Layer) Undelegate txHash: ${txCommitSgn}`,
        );
    });

    it("Revoke session on Magic Router", async () => {
        const start = Date.now();

        const tx = await sessionTokenManager.program.methods
            .revokeSession()
            .accounts({
                sessionToken: sessionTokenPDA,
            })
            .transaction()
        const txHash = await sendAndConfirmTransaction(connection, tx, [sessionKeypair], {
            skipPreflight: true,
            commitment: "confirmed",
        });
        const duration = Date.now() - start;
        console.log(`${duration}ms (Magic Router) revokeSession txHash: ${txHash}`);
    })
});
