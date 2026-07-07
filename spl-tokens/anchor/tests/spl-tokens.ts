import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  createInitializeMintInstruction,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
  createMintToInstruction,
} from "@solana/spl-token";
import { SplTokens } from "../target/types/spl_tokens";
import {
  delegateSpl,
  deriveRentPda,
  GetCommitmentSignature,
  transferSpl,
  undelegateIx,
  withdrawSpl,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { assert } from "chai";

describe("spl-tokens", () => {
  console.log("spl-tokens.ts");

  const provider = process.env.PROVIDER_ENDPOINT
    ? new anchor.AnchorProvider(
        new anchor.web3.Connection(process.env.PROVIDER_ENDPOINT, "confirmed"),
        anchor.Wallet.local(),
      )
    : anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const validator = new PublicKey(
    process.env.VALIDATOR || "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
  );
  console.log("Validator: ", validator.toBase58());

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://devnet-as.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT ||
          "wss://devnet-as.magicblock.app/",
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

  const TOKEN_AMOUNT = 1000n;

  const sleep = async (ms: number): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  };

  /**
   * Base-layer delegation can confirm before the ER has cloned the token
   * account. Poll the ER view before sending transfer instructions that write
   * those delegated accounts.
   */
  const waitForErTokenAccount = async (
    ata: PublicKey,
    expectedAmount: bigint,
  ): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const account = await getAccount(ephemeralConnection, ata);
        if (account.amount === expectedAmount) {
          return;
        }
        lastError = new Error(
          `expected ${expectedAmount}, got ${account.amount}`,
        );
      } catch (error) {
        lastError = error;
      }
      await sleep(500);
    }

    throw new Error(
      `Timed out waiting for ER token account ${ata.toBase58()}: ${lastError}`,
    );
  };

  /**
   * Create a fresh mint and two recipients, each funded with SOL and holding
   * {@link TOKEN_AMOUNT} SPL tokens. Returns the mint, owners and their ATAs.
   */
  const setupMintWithRecipients = async (): Promise<{
    mint: Keypair;
    owners: [Keypair, Keypair];
    atas: [PublicKey, PublicKey];
  }> => {
    const payer = (provider.wallet as anchor.Wallet).payer;

    const newMint = Keypair.generate();
    const owner1 = Keypair.generate();
    const owner2 = Keypair.generate();
    /// We need to fund the sponsor PDA to pay for the rent of the shuttles
    const [sponsorPda] = deriveRentPda();

    // fund recipients from payer wallet (avoids faucet rate limits / 429s)
    const fundTx = new anchor.web3.Transaction();
    for (const r of [owner1.publicKey, owner2.publicKey, sponsorPda]) {
      fundTx.add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: r,
          lamports: 0.2 * LAMPORTS_PER_SOL,
        }),
      );
    }
    await anchor.web3.sendAndConfirmTransaction(connection, fundTx, [payer]);

    const ata1 = getAssociatedTokenAddressSync(
      newMint.publicKey,
      owner1.publicKey,
    );
    const ata2 = getAssociatedTokenAddressSync(
      newMint.publicKey,
      owner2.publicKey,
    );

    const tx = new anchor.web3.Transaction().add(
      // create mint
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: newMint.publicKey,
        space: MINT_SIZE,
        lamports: await getMinimumBalanceForRentExemptMint(connection),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        newMint.publicKey,
        0,
        payer.publicKey,
        null,
      ),

      // create ATAs
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata1,
        owner1.publicKey,
        newMint.publicKey,
      ),
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata2,
        owner2.publicKey,
        newMint.publicKey,
      ),

      // mint tokens
      createMintToInstruction(
        newMint.publicKey,
        ata1,
        payer.publicKey,
        TOKEN_AMOUNT,
      ),
      createMintToInstruction(
        newMint.publicKey,
        ata2,
        payer.publicKey,
        TOKEN_AMOUNT,
      ),
    );

    await provider.sendAndConfirm(tx, [payer, newMint], {
      commitment: "confirmed",
    });

    const acct1 = await getAccount(connection, ata1);
    const acct2 = await getAccount(connection, ata2);
    if (acct1.amount !== TOKEN_AMOUNT) {
      throw new Error(`owner1 expected ${TOKEN_AMOUNT}, got ${acct1.amount}`);
    }
    if (acct2.amount !== TOKEN_AMOUNT) {
      throw new Error(`owner2 expected ${TOKEN_AMOUNT}, got ${acct2.amount}`);
    }

    return {
      mint: newMint,
      owners: [owner1, owner2],
      atas: [ata1, ata2],
    };
  };

  /**
   * Setup 2 recipients, with 1000 SPL tokens each for a random mint
   */
  before(async () => {
    const setup = await setupMintWithRecipients();
    mint = setup.mint;
    [recipientA, recipientB] = setup.owners;
  });

  it("Delegate SPL tokens, do a transfer and undelegate", async () => {
    const admin = (provider.wallet as anchor.Wallet).payer;
    console.log("\nUser1: ", recipientA.publicKey.toBase58());
    console.log("User2: ", recipientB.publicKey.toBase58());
    const ataA = getAssociatedTokenAddressSync(
      mint.publicKey,
      recipientA.publicKey,
    );
    const ataB = getAssociatedTokenAddressSync(
      mint.publicKey,
      recipientB.publicKey,
    );

    assert((await getAccount(connection, ataA)).amount == 1000n);
    assert((await getAccount(connection, ataB)).amount == 1000n);

    // Legacy vault flow — must match undelegateIx/withdrawSpl below (the SDK's
    // default idempotent shuttle path uses a different account layout).
    const delegateOpts = {
      validator,
      idempotent: false as const,
      payer: admin.publicKey,
    };

    // A's delegation creates the shared vault for this mint; B reuses it.
    const delegations: [Keypair, bigint, boolean][] = [
      [recipientA, 50n, true],
      [recipientB, 10n, false],
    ];
    for (const [owner, amount, initVaultIfMissing] of delegations) {
      const ixs = await delegateSpl(owner.publicKey, mint.publicKey, amount, {
        ...delegateOpts,
        initVaultIfMissing,
      });
      await provider.sendAndConfirm(
        new anchor.web3.Transaction().add(...ixs),
        [owner, admin],
        { commitment: "confirmed", skipPreflight: true },
      );
    }
    await Promise.all([
      waitForErTokenAccount(ataA, 50n),
      waitForErTokenAccount(ataB, 10n),
    ]);

    // Transfer 2 tokens A -> B inside the ER via the SDK helper.
    const transferIxs = await transferSpl(
      recipientA.publicKey,
      recipientB.publicKey,
      mint.publicKey,
      2n,
      {
        visibility: "public",
        fromBalance: "ephemeral",
        toBalance: "ephemeral",
      },
    );
    const sgnTransfer = await providerEphemeralRollup.sendAndConfirm(
      new anchor.web3.Transaction().add(...transferIxs),
      [recipientA],
      { commitment: "confirmed", skipPreflight: true },
    );
    console.log(`\nTransfer signature: ${sgnTransfer}`);

    // Check balances in the ER
    const acctA = await getAccount(ephemeralConnection, ataA);
    const acctB = await getAccount(ephemeralConnection, ataB);
    assert(acctA.amount == 48n);
    assert(acctB.amount == 12n);

    // Undelegate each owner in the ER (one per tx — combined undelegates are flaky
    // in CI). Withdraw runs on the base layer and requires each ephemeral ATA to be
    // owned by the SDK program again, which only happens once that owner's
    // undelegation has committed back to base — so wait for BOTH commits before
    // withdrawing (waiting for one races the other's withdraw → InvalidAccountOwner).
    const commits: string[] = [];
    for (const owner of [recipientA, recipientB]) {
      const sgn = await providerEphemeralRollup.sendAndConfirm(
        new anchor.web3.Transaction().add(
          undelegateIx(owner.publicKey, mint.publicKey),
        ),
        [owner],
        { commitment: "confirmed", skipPreflight: true },
      );
      console.log(`Undelegate ${owner.publicKey.toBase58()} signature: ${sgn}`);
      commits.push(
        await GetCommitmentSignature(sgn, providerEphemeralRollup.connection),
      );
    }
    await Promise.all(
      commits.map((c) => connection.confirmTransaction(c, "confirmed")),
    );

    // Withdraw both balances back to their base-layer ATAs via the SDK helper.
    const withdrawIxs = [
      ...(await withdrawSpl(
        recipientA.publicKey,
        mint.publicKey,
        acctA.amount,
        {
          idempotent: false,
        },
      )),
      ...(await withdrawSpl(
        recipientB.publicKey,
        mint.publicKey,
        acctB.amount,
        {
          idempotent: false,
        },
      )),
    ];
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(...withdrawIxs),
      [recipientA, recipientB],
      { commitment: "confirmed" },
    );

    // Check balances
    assert((await getAccount(connection, ataA)).amount == 998n);
    assert((await getAccount(connection, ataB)).amount == 1002n);
  });

  const program = anchor.workspace.SplTokens as Program<SplTokens>;

  it("Delegate SPL tokens and do a transfer through a program", async () => {
    const admin = (provider.wallet as anchor.Wallet).payer;
    const delegateOpts = {
      validator,
      idempotent: false as const,
      payer: admin.publicKey,
    };

    // Use a fresh mint + fresh recipients so this test does not depend on the
    // delegate/undelegate lifecycle of the first test.
    const {
      mint: mint2,
      owners: [sender, receiver],
      atas: [ataSender, ataReceiver],
    } = await setupMintWithRecipients();

    // Delegate 10 tokens for the sender (first delegation for this mint creates
    // the vault) and 10 for the receiver.
    const ixsSender = await delegateSpl(
      sender.publicKey,
      mint2.publicKey,
      10n,
      {
        ...delegateOpts,
        initVaultIfMissing: true,
      },
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(...ixsSender),
      [sender, admin],
      { commitment: "confirmed", skipPreflight: true },
    );

    const ixsReceiver = await delegateSpl(
      receiver.publicKey,
      mint2.publicKey,
      10n,
      { ...delegateOpts, initVaultIfMissing: false },
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(...ixsReceiver),
      [receiver, admin],
      { commitment: "confirmed", skipPreflight: true },
    );
    await Promise.all([
      waitForErTokenAccount(ataSender, 10n),
      waitForErTokenAccount(ataReceiver, 10n),
    ]);

    /// Transfer some tokens in the ER through the program
    const txT = await program.methods
      .transfer(new BN(2))
      .accounts({
        payer: sender.publicKey,
        from: ataSender,
        to: ataReceiver,
      })
      .transaction();
    txT.recentBlockhash = (
      await ephemeralConnection.getLatestBlockhash()
    ).blockhash;
    txT.sign(sender);

    const sgn = await ephemeralConnection.sendRawTransaction(txT.serialize(), {
      skipPreflight: true,
    });
    const conf = await ephemeralConnection.confirmTransaction(sgn, "confirmed");
    if (conf.value.err) {
      throw new Error(
        `Program transfer failed: ${JSON.stringify(conf.value.err)}`,
      );
    }
    console.log(`\nTransfer signature: ${sgn}`);

    // Verify the transfer actually moved tokens inside the ER.
    const erSender = await getAccount(ephemeralConnection, ataSender);
    const erReceiver = await getAccount(ephemeralConnection, ataReceiver);
    assert(erSender.amount == 8n, `sender ER balance ${erSender.amount}`);
    assert(
      erReceiver.amount == 12n,
      `receiver ER balance ${erReceiver.amount}`,
    );
  });
});
