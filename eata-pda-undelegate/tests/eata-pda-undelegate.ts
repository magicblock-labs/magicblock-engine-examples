import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Signer,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import {
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  deriveEphemeralAta,
  initEphemeralAtaIx,
  delegateEphemeralAtaIx,
  GetCommitmentSignature,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { EataPdaUndelegate } from "../target/types/eata_pda_undelegate";
import { assert } from "chai";

/**
 * Reproduction for: undelegating an ephemeral ATA (eATA) whose SPL authority
 * (`owner`) is *a delegated account* fails.
 *
 * e-token's `undelegate_ephemeral_ata` (commit c7e9fff) calls:
 *   commit_and_undelegate_accounts(payer, [ata], magic_context, magic_program,
 *                                  None,   // <- magic_fee_vault
 *                                  None)   // <- signer_seeds
 * When the eATA owner (`payer`) is itself a delegated account, the magic
 * program's ScheduleCommit REQUIRES a valid validator magic fee vault to
 * charge the commit against — but e-token passes `None`, so the commit fails
 * with `ScheduleCommit ERR: invalid magic fee vault account ...`.
 * A wallet-owned (non-delegated) eATA does not need a fee vault, so it works.
 * (This is what the `fix/undelegate-eata-fee-vault` branch addresses.)
 *
 * Two flows that differ ONLY in whether the eATA owner is delegated:
 *   1. control : owner = a wallet keypair (not delegated)        -> succeeds
 *   2. repro   : owner = this program's PDA, delegated to the ER -> fails
 */
describe("eata-pda-undelegate", () => {
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

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://devnet-as.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app/",
      },
    ),
    anchor.Wallet.local(),
  );
  const ephemeralConnection = providerEphemeralRollup.connection;

  const program = anchor.workspace
    .EataPdaUndelegate as Program<EataPdaUndelegate>;
  const payer = (provider.wallet as anchor.Wallet).payer;

  // The validator magic fee vault, PDA of the delegation program.
  const [magicFeeVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("v-fees-vault"), validator.toBuffer()],
    DELEGATION_PROGRAM_ID,
  );

  // Program PDA that owns the eATA in the repro case (scoped to the mint so the
  // example is re-runnable without resetting the validator).
  const deriveAuthorityPda = (m: PublicKey): PublicKey =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("authority"), m.toBuffer()],
      program.programId,
    )[0];

  let mint: Keypair;
  let authorityPda: PublicKey;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const createMint = async (): Promise<Keypair> => {
    const m = Keypair.generate();
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: m.publicKey,
        space: MINT_SIZE,
        lamports: await getMinimumBalanceForRentExemptMint(connection),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(m.publicKey, 0, payer.publicKey, null),
    );
    await provider.sendAndConfirm(tx, [payer, m], { commitment: "confirmed" });
    return m;
  };

  const createAndFundAta = async (
    owner: PublicKey,
    amount: number,
  ): Promise<PublicKey> => {
    const ata = getAssociatedTokenAddressSync(mint.publicKey, owner, true);
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        owner,
        mint.publicKey,
      ),
    );
    if (amount > 0) {
      tx.add(
        createMintToInstruction(mint.publicKey, ata, payer.publicKey, amount),
      );
    }
    await provider.sendAndConfirm(tx, [payer], { commitment: "confirmed" });
    return ata;
  };

  const initAndDelegateEata = async (owner: PublicKey): Promise<PublicKey> => {
    const [eata] = deriveEphemeralAta(owner, mint.publicKey);
    await provider.sendAndConfirm(
      new Transaction().add(
        initEphemeralAtaIx(eata, owner, mint.publicKey, payer.publicKey),
      ),
      [payer],
      { commitment: "confirmed", skipPreflight: true },
    );
    await provider.sendAndConfirm(
      new Transaction().add(
        delegateEphemeralAtaIx(payer.publicKey, eata, validator),
      ),
      [payer],
      { commitment: "confirmed", skipPreflight: true },
    );
    return eata;
  };

  const waitForErAccount = async (acc: PublicKey): Promise<void> => {
    for (let i = 0; i < 60; i++) {
      if (await ephemeralConnection.getAccountInfo(acc)) return;
      await sleep(500);
    }
    throw new Error(`Timed out waiting for ER to clone ${acc.toBase58()}`);
  };

  /** e-token 5-account `undelegate` instruction (owner as signer, commit c7e9fff). */
  const buildUndelegateIx = (owner: PublicKey): TransactionInstruction => {
    const userAta = getAssociatedTokenAddressSync(mint.publicKey, owner, true);
    const [eata] = deriveEphemeralAta(owner, mint.publicKey);
    return new TransactionInstruction({
      programId: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: false },
        { pubkey: userAta, isSigner: false, isWritable: true },
        { pubkey: eata, isSigner: false, isWritable: false },
        { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
        { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([5]),
    });
  };

  type SendResult = { sig?: string; err?: unknown; logs?: string[] };

  const send = async (
    conn: Connection,
    ix: TransactionInstruction,
    feePayer: PublicKey,
    signers: Signer[],
  ): Promise<SendResult> => {
    const tx = new Transaction().add(ix);
    tx.feePayer = feePayer;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(...signers);
    try {
      const sig = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      const conf = await conn.confirmTransaction(sig, "confirmed");
      const t = await conn.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      return { sig, err: conf.value.err ?? undefined, logs: t?.meta?.logMessages ?? [] };
    } catch (e: any) {
      return { err: e.message ?? e, logs: e.logs };
    }
  };

  const printLogs = (label: string, r: SendResult) => {
    console.log(`\n[${label}] err: ${JSON.stringify(r.err)}`);
    (r.logs || []).forEach((l) => console.log("   ", l));
  };

  /** Follow the ER->base commit and report whether the base commit succeeded. */
  const traceCommitToBase = async (erSig: string): Promise<SendResult> => {
    try {
      const baseSig = await GetCommitmentSignature(erSig, ephemeralConnection);
      const conf = await connection.confirmTransaction(baseSig, "confirmed");
      const t = await connection.getTransaction(baseSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      return {
        sig: baseSig,
        err: conf.value.err ?? undefined,
        logs: t?.meta?.logMessages ?? [],
      };
    } catch (e: any) {
      return { err: `commit trace failed: ${e.message ?? e}` };
    }
  };

  before(async () => {
    console.log("Base layer:     ", connection.rpcEndpoint);
    console.log("Ephemeral (ER): ", ephemeralConnection.rpcEndpoint);
    console.log("Program:        ", program.programId.toBase58());
    console.log("Magic fee vault:", magicFeeVault.toBase58());
    mint = await createMint();
    authorityPda = deriveAuthorityPda(mint.publicKey);
    console.log("Mint:           ", mint.publicKey.toBase58());
    console.log("Authority PDA:  ", authorityPda.toBase58());
  });

  it("control: wallet-owned eATA undelegates successfully", async () => {
    const owner = Keypair.generate();
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: owner.publicKey,
          lamports: 0.2 * LAMPORTS_PER_SOL,
        }),
      ),
      [payer],
    );

    await createAndFundAta(owner.publicKey, 100);
    const eata = await initAndDelegateEata(owner.publicKey);
    await waitForErAccount(eata);

    const er = await send(
      ephemeralConnection,
      buildUndelegateIx(owner.publicKey),
      owner.publicKey,
      [owner],
    );
    printLogs("control ER", er);
    assert.isUndefined(er.err, `control ER undelegate should succeed`);

    const base = await traceCommitToBase(er.sig!);
    printLogs("control base commit", base);
    assert.isUndefined(base.err, `control base commit should succeed`);
  });

  it("repro: eATA owned by a delegated PDA fails to undelegate (None magic fee vault)", async () => {
    const owner = authorityPda;

    // 1. Create the authority PDA as a program-owned account and delegate it to
    //    the ER, so the eATA's owner is itself "a delegated account".
    await program.methods
      .initAuthority()
      .accounts({ payer: payer.publicKey, mint: mint.publicKey })
      .rpc({ commitment: "confirmed" });
    await program.methods
      .delegateAuthority()
      .accounts({
        payer: payer.publicKey,
        mint: mint.publicKey,
        pda: authorityPda,
      })
      .remainingAccounts([
        { pubkey: validator, isSigner: false, isWritable: false },
      ])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // 2. Create the eATA (owner = the delegated authority PDA) and delegate it.
    const userAta = await createAndFundAta(owner, 100);
    const eata = await initAndDelegateEata(owner);
    await waitForErAccount(eata);
    await waitForErAccount(authorityPda);

    // 3. Undelegate the eATA via CPI, signing for the delegated PDA owner.
    const ix = await program.methods
      .undelegateOwnedEata()
      .accounts({
        payer: payer.publicKey,
        mint: mint.publicKey,
        authority: authorityPda,
        userAta,
        ephemeralAta: eata,
        magicContext: MAGIC_CONTEXT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
        ephemeralSplTokenProgram: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
      })
      .instruction();

    const er = await send(ephemeralConnection, ix, payer.publicKey, [payer]);
    printLogs("repro ER", er);

    let baseErr: unknown = undefined;
    if (er.err === undefined && er.sig) {
      const base = await traceCommitToBase(er.sig);
      printLogs("repro base commit", base);
      baseErr = base.err;
    }

    const failed = er.err !== undefined || baseErr !== undefined;
    console.log(
      "\n[repro] SUMMARY: undelegating a delegated-PDA-owned eATA " +
        (failed ? "FAILED (bug reproduced)" : "unexpectedly SUCCEEDED"),
    );
    assert.isTrue(
      failed,
      "expected the delegated-PDA-owned undelegate to FAIL (reproducing the bug), " +
        "but both the ER schedule and the base commit succeeded",
    );
  });
});
