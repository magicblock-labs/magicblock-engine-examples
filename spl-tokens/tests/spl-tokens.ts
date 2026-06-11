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
  createTransferInstruction,
} from "@solana/spl-token";
import { SplTokens } from "../target/types/spl_tokens";
import {
  delegateSpl,
  deriveRentPda,
  GetCommitmentSignature,
  undelegateIx,
  withdrawSplIx,
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

    let acctA = await getAccount(connection, ataA);
    let acctB = await getAccount(connection, ataB);

    assert(acctA.amount == 1000n);
    assert(acctB.amount == 1000n);

    // Legacy vault flow — must match undelegateIx/withdrawSplIx below (SDK default
    // idempotent shuttle path uses a different account layout).
    const delegateOpts = {
      validator,
      idempotent: false as const,
      payer: admin.publicKey,
    };
    const ixs = await delegateSpl(recipientA.publicKey, mint.publicKey, 50n, {
      ...delegateOpts,
      initVaultIfMissing: true,
    });
    const tx = new anchor.web3.Transaction();
    ixs.forEach((ix) => tx.add(ix));
    await provider.sendAndConfirm(tx, [recipientA, admin], {
      commitment: "confirmed",
      skipPreflight: true,
    });

    // Delegate 10 tokens for recipientB
    const ixs2 = await delegateSpl(recipientB.publicKey, mint.publicKey, 10n, {
      ...delegateOpts,
    });
    const tx2 = new anchor.web3.Transaction();
    ixs2.forEach((ix) => tx2.add(ix));

    await provider.sendAndConfirm(tx2, [recipientB, admin], {
      commitment: "confirmed",
      skipPreflight: true,
    });

    /// Transfer some tokens in the ER
    const amountToTransfer = 2;
    const ixTransfer = createTransferInstruction(
      ataA, // source
      ataB, // destination
      recipientA.publicKey,
      amountToTransfer,
      [],
      TOKEN_PROGRAM_ID,
    );
    let sgn = await providerEphemeralRollup.sendAndConfirm(
      new anchor.web3.Transaction().add(ixTransfer),
      [recipientA],
      { commitment: "confirmed", skipPreflight: true },
    );
    console.log(`\nTransfer signature: ${sgn}`);

    // Check balances in the ER
    acctA = await getAccount(ephemeralConnection, ataA);
    acctB = await getAccount(ephemeralConnection, ataB);
    assert(acctA.amount == 48n);
    assert(acctB.amount == 12n);

    // Undelegate ER balance (one owner per tx — combined undelegates are flaky in CI)
    const ixUndelegateA = undelegateIx(recipientA.publicKey, mint.publicKey);
    const ixUndelegateB = undelegateIx(recipientB.publicKey, mint.publicKey);
    sgn = await providerEphemeralRollup.sendAndConfirm(
      new anchor.web3.Transaction().add(ixUndelegateA),
      [recipientA],
      { commitment: "confirmed", skipPreflight: true },
    );
    console.log(`Undelegate A signature: ${sgn}`);
    sgn = await providerEphemeralRollup.sendAndConfirm(
      new anchor.web3.Transaction().add(ixUndelegateB),
      [recipientB],
      { commitment: "confirmed", skipPreflight: true },
    );
    console.log(`Undelegate B signature: ${sgn}`);
    const txCommitSgn = await GetCommitmentSignature(
      sgn,
      providerEphemeralRollup.connection,
    );
    await connection.confirmTransaction(txCommitSgn, "confirmed");

    // Withdraw from both accounts
    const tx3 = new anchor.web3.Transaction();
    tx3.add(withdrawSplIx(recipientA.publicKey, mint.publicKey, acctA.amount));
    tx3.add(withdrawSplIx(recipientB.publicKey, mint.publicKey, acctB.amount));
    await provider.sendAndConfirm(tx3, [recipientA, recipientB], {
      commitment: "confirmed",
    });

    // Check balances
    acctA = await getAccount(connection, ataA);
    acctB = await getAccount(connection, ataB);
    assert(acctA.amount == 998n);
    assert(acctB.amount == 1002n);
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
