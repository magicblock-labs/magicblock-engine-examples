import * as anchor from "@coral-xyz/anchor";
import {BN, Program} from "@coral-xyz/anchor";
import {
    Keypair,
    LAMPORTS_PER_SOL, PublicKey,
    SystemProgram,
} from "@solana/web3.js";

import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    getAccount,
    createInitializeMintInstruction, MINT_SIZE, getMinimumBalanceForRentExemptMint, createMintToInstruction,
    createTransferInstruction,
} from "@solana/spl-token";
import {SplTokens} from "../target/types/spl_tokens";
import {
    delegateSpl, GetCommitmentSignature,
    undelegateIx, withdrawSplIx
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {assert} from "chai";

describe("spl-tokens", () => {
    console.log("spl-tokens.ts");

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const connection = provider.connection;
    let validator: PublicKey;

    const providerEphemeralRollup = new anchor.AnchorProvider(
      // new anchor.web3.Connection(
      //   process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
      //     "https://devnet-as.magicblock.app/",
      //     {
      //         wsEndpoint:
      //             process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app/",
      //     },
      // ),
        new anchor.web3.Connection(
            process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
            "http://localhost:7799",
            {
                wsEndpoint:
                    process.env.EPHEMERAL_WS_ENDPOINT || "ws://localhost:7800",
            },
        ),
      anchor.Wallet.local(),
    );
    console.log(
      "Ephemeral Rollup Connection: ",
      providerEphemeralRollup.connection.rpcEndpoint,
    );
    const ephemeralConnection = providerEphemeralRollup.connection;

    let mint: Keypair;
    let recipientA: Keypair;
    let recipientB: Keypair;

    /**
     * Setup 2 recipients, with 1000 SPL tokens each for a random mint
     */
    before(async () => {
        const payer = (provider.wallet as anchor.Wallet).payer;

        recipientA = Keypair.generate();
        recipientB = Keypair.generate();

        // fund recipients so they can exist and sign if needed
        for (const r of [recipientA, recipientB]) {
            await connection.confirmTransaction(
                await connection.requestAirdrop(
                    r.publicKey,
                    0.2 * LAMPORTS_PER_SOL
                ),
                "confirmed"
            );
        }

        mint = Keypair.generate();
        const decimals = 0;
        const amount = 1000n;

        const ataA = getAssociatedTokenAddressSync(
            mint.publicKey,
            recipientA.publicKey
        );

        const ataB = getAssociatedTokenAddressSync(
            mint.publicKey,
            recipientB.publicKey
        );

        const tx = new anchor.web3.Transaction().add(
            // create mint
            SystemProgram.createAccount({
                fromPubkey: payer.publicKey,
                newAccountPubkey: mint.publicKey,
                space: MINT_SIZE,
                lamports: await getMinimumBalanceForRentExemptMint(connection),
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMintInstruction(
                mint.publicKey,
                decimals,
                payer.publicKey,
                null
            ),

            // create ATAs
            createAssociatedTokenAccountInstruction(
                payer.publicKey,
                ataA,
                recipientA.publicKey,
                mint.publicKey
            ),
            createAssociatedTokenAccountInstruction(
                payer.publicKey,
                ataB,
                recipientB.publicKey,
                mint.publicKey
            ),

            // mint tokens
            createMintToInstruction(
                mint.publicKey,
                ataA,
                payer.publicKey,
                amount
            ),
            createMintToInstruction(
                mint.publicKey,
                ataB,
                payer.publicKey,
                amount
            )
        );

        await provider.sendAndConfirm(
            tx,
            [payer, mint],
            {commitment: "confirmed"}
        );

        const acctA = await getAccount(connection, ataA);
        const acctB = await getAccount(connection, ataB);

        if (acctA.amount !== amount) {
            throw new Error(`Recipient A expected ${amount}, got ${acctA.amount}`);
        }
        if (acctB.amount !== amount) {
            throw new Error(`Recipient B expected ${amount}, got ${acctB.amount}`);
        }

        // Get the validator identity
        validator = new PublicKey((await (ephemeralConnection as any)._rpcRequest("getIdentity", []))!.result!.identity);
        console.log("Validator: ", validator.toBase58());
    });

    it("Delegate SPL tokens, do a transfer and undelegate", async () => {
        console.log("\nUser1: ", recipientA.publicKey.toBase58());
        console.log("User2: ", recipientB.publicKey.toBase58());
        const ataA = getAssociatedTokenAddressSync(
            mint.publicKey,
            recipientA.publicKey
        );

        const ataB = getAssociatedTokenAddressSync(
            mint.publicKey,
            recipientB.publicKey
        );

        let acctA = await getAccount(connection, ataA);
        let acctB = await getAccount(connection, ataB);

        assert(acctA.amount == 1000n);
        assert(acctB.amount == 1000n);

        // Delegate 50 tokens for recipientA
        // multiply amount if decimals > 0: * (10n ** BigInt(decimals))
        const ixs = await delegateSpl(recipientA.publicKey, mint.publicKey, 50n, {validator: validator});
        const tx = new anchor.web3.Transaction();
        ixs.forEach(ix => tx.add(ix));
        await provider.sendAndConfirm(tx, [recipientA], { commitment: "confirmed", skipPreflight: true });

        // Delegate 10 tokens for recipientB
        const ixs2 = await delegateSpl(recipientB.publicKey, mint.publicKey, 10n, {validator: validator});
        const tx2 = new anchor.web3.Transaction();
        ixs2.forEach(ix => tx2.add(ix));

        await provider.sendAndConfirm(tx2, [recipientB], { commitment: "confirmed", skipPreflight: true });

        /// Transfer some tokens in the ER
        const amountToTransfer = 2;
        const ixTransfer = createTransferInstruction(
            ataA, // source
            ataB, // destination
            recipientA.publicKey,
            amountToTransfer,
            [],
            TOKEN_PROGRAM_ID
        );
        let sgn = await providerEphemeralRollup.sendAndConfirm(new anchor.web3.Transaction().add(ixTransfer), [recipientA], { commitment: "confirmed", skipPreflight: true });
        console.log(`\nTransfer signature: ${sgn}`)

        // Check balances in the ER
        acctA = await getAccount(ephemeralConnection, ataA);
        acctB = await getAccount(ephemeralConnection, ataB);
        assert(acctA.amount == 48n);
        assert(acctB.amount == 12n);

        // Undelegate ER balance
        const ixUndelegateA = undelegateIx(recipientA.publicKey, mint.publicKey);
        const ixUndelegateB = undelegateIx(recipientB.publicKey, mint.publicKey);
        sgn = await providerEphemeralRollup.sendAndConfirm(new anchor.web3.Transaction().add(ixUndelegateA).add(ixUndelegateB), [recipientA, recipientB], { commitment: "confirmed", skipPreflight: true });
        console.log(`Undelegate signature: ${sgn}`)
        const txCommitSgn = await GetCommitmentSignature(
            sgn,
            providerEphemeralRollup.connection,
        );
        await connection.confirmTransaction(txCommitSgn, "confirmed");

        // Withdraw from both accounts
        const tx3 = new anchor.web3.Transaction();
        tx3.add(withdrawSplIx(recipientA.publicKey, mint.publicKey, acctA.amount));
        tx3.add(withdrawSplIx(recipientB.publicKey, mint.publicKey, acctB.amount));
        await provider.sendAndConfirm(tx3, [recipientA, recipientB], { commitment: "confirmed" });

        // Check balances
        acctA = await getAccount(connection, ataA);
        acctB = await getAccount(connection, ataB);
        assert(acctA.amount == 998n);
        assert(acctB.amount == 1002n);
    });

    const program = anchor.workspace.SplTokens as Program<SplTokens>;

    it("Delegate SPL tokens and do a transfer trough a program", async () => {
        const ataA = getAssociatedTokenAddressSync(
            mint.publicKey,
            recipientA.publicKey
        );

        const ataB = getAssociatedTokenAddressSync(
            mint.publicKey,
            recipientB.publicKey
        );

        let acctA = await getAccount(connection, ataA);
        let acctB = await getAccount(connection, ataB);

        // Delegate 10 tokens for recipientA
        // multiply amount if decimals > 0: * (10n ** BigInt(decimals))
        const ixs = await delegateSpl(recipientA.publicKey, mint.publicKey, 10n, {validator: validator});
        const tx = new anchor.web3.Transaction();
        ixs.forEach(ix => tx.add(ix));
        await provider.sendAndConfirm(tx, [recipientA], { commitment: "confirmed" });

        // Delegate 10 tokens for recipientB
        const ixs2 = await delegateSpl(recipientB.publicKey, mint.publicKey, 10n, {validator: validator});
        const tx2 = new anchor.web3.Transaction();
        ixs2.forEach(ix => tx2.add(ix));

        await provider.sendAndConfirm(tx2, [recipientB], { commitment: "confirmed" });

        /// Transfer some tokens in the ER through a program
        const txT = await program.methods.transfer(new BN(2)).accounts({
            payer: recipientA.publicKey,
            from: ataA,
            to: ataB,
        }).transaction();
        txT.recentBlockhash = (await ephemeralConnection.getLatestBlockhash()).blockhash;
        txT.sign(recipientA);
        const sgn = await ephemeralConnection.sendRawTransaction(txT.serialize(), { skipPreflight: true });
        await ephemeralConnection.confirmTransaction(sgn, "confirmed");
        console.log(`\nTransfer signature: ${sgn}`);
    });

});
