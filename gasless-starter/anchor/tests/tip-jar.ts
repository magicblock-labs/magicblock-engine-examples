import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import {
  delegateEphemeralAtaIx,
  delegateSpl,
  deriveEphemeralAta,
  deriveRentPda,
  initEphemeralAtaIx,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { assert } from "chai";
import { TipJar } from "../target/types/tip_jar";

// The hosted Payments API is not available on a local validator, so this test
// plays the sponsor itself: the local wallet pays every base-layer fee, exactly
// as the API's sponsor does on devnet. The tipper and the jar authority never
// hold SOL, and every ER transaction below uses one of them as the fee payer.
describe("tip-jar", () => {
  const provider = process.env.PROVIDER_ENDPOINT
    ? new anchor.AnchorProvider(
        new Connection(process.env.PROVIDER_ENDPOINT, "confirmed"),
        anchor.Wallet.local(),
      )
    : anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const er = new Connection(
    process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
      "https://devnet-as.magicblock.app/",
    {
      wsEndpoint:
        process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app/",
      commitment: "confirmed",
    },
  );
  const validator = new PublicKey(
    process.env.VALIDATOR || "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
  );
  const program = anchor.workspace.TipJar as Program<TipJar>;
  const sponsor = (provider.wallet as anchor.Wallet).payer;

  const mint = Keypair.generate();
  const tipper = Keypair.generate();
  const authority = Keypair.generate();
  const [jar] = PublicKey.findProgramAddressSync(
    [Buffer.from("jar"), authority.publicKey.toBuffer()],
    program.programId,
  );
  const tokenAccount = (owner: PublicKey) =>
    getAssociatedTokenAddressSync(mint.publicKey, owner, true);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function erTokenBalance(owner: PublicKey): Promise<bigint> {
    try {
      return (await getAccount(er, tokenAccount(owner))).amount;
    } catch {
      return -1n;
    }
  }

  async function waitFor(check: () => Promise<boolean>, what: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await check()) return;
      await sleep(500);
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  // Delegate `owner`'s ephemeral ATA so the ER can write its token account.
  // Works for wallets and PDAs alike; only the payer signs.
  const custodyInstructions = (owner: PublicKey) => {
    const [eata] = deriveEphemeralAta(owner, mint.publicKey);
    return [
      createAssociatedTokenAccountIdempotentInstruction(
        sponsor.publicKey,
        tokenAccount(owner),
        owner,
        mint.publicKey,
      ),
      initEphemeralAtaIx(eata, owner, mint.publicKey, sponsor.publicKey),
      delegateEphemeralAtaIx(sponsor.publicKey, eata, validator),
    ];
  };

  // An ER transaction paid by a wallet with zero SOL.
  async function sendOnEr(feePayer: Keypair, ix: TransactionInstruction) {
    const { blockhash, lastValidBlockHeight } = await er.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: feePayer.publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(ix);
    tx.sign(feePayer);
    const signature = await er.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    const result = await er.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (result.value.err) {
      throw new Error(
        `ER transaction failed: ${JSON.stringify(result.value.err)}`,
      );
    }
    return signature;
  }

  before(async () => {
    // Fund the ESPL rent PDA (pays for deposit shuttles) and create a 6-decimal
    // mint with 10 tokens for the tipper.
    const [rentPda] = deriveRentPda();
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: sponsor.publicKey,
          toPubkey: rentPda,
          lamports: 0.2 * LAMPORTS_PER_SOL,
        }),
        SystemProgram.createAccount({
          fromPubkey: sponsor.publicKey,
          newAccountPubkey: mint.publicKey,
          space: MINT_SIZE,
          lamports: await getMinimumBalanceForRentExemptMint(connection),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          mint.publicKey,
          6,
          sponsor.publicKey,
          null,
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          sponsor.publicKey,
          tokenAccount(tipper.publicKey),
          tipper.publicKey,
          mint.publicKey,
        ),
        createMintToInstruction(
          mint.publicKey,
          tokenAccount(tipper.publicKey),
          sponsor.publicKey,
          10_000_000,
        ),
      ),
      [sponsor, mint],
    );
  });

  it("creates and delegates a jar (one-time, sponsor pays SOL)", async () => {
    const createJar = await program.methods
      .createJar(validator)
      .accountsPartial({
        payer: sponsor.publicKey,
        authority: authority.publicKey,
        jar,
        mint: mint.publicKey,
        jarToken: tokenAccount(jar),
      })
      .instruction();
    const [jarEata] = deriveEphemeralAta(jar, mint.publicKey);
    const delegateJar = await program.methods
      .delegateJar()
      .accountsPartial({ payer: sponsor.publicKey, jar })
      .instruction();
    await provider.sendAndConfirm(
      new Transaction().add(
        createJar,
        initEphemeralAtaIx(jarEata, jar, mint.publicKey, sponsor.publicKey),
        delegateEphemeralAtaIx(sponsor.publicKey, jarEata, validator),
        delegateJar,
        // The authority's own token account receives withdrawn tips on the ER.
        ...custodyInstructions(authority.publicKey),
      ),
      [sponsor, authority],
      { skipPreflight: true },
    );

    await waitFor(
      async () => (await erTokenBalance(jar)) === 0n,
      "jar token account on the ER",
    );
    const saved = await program.account.jar.fetch(jar);
    assert.ok(saved.authority.equals(authority.publicKey));
    assert.ok(saved.validator.equals(validator));
  });

  it("deposits the tipper's tokens into the ER", async () => {
    // This is the instruction set the Payments API's /v1/spl/deposit returns,
    // minus its 0.20 USDC relay-fee transfer. The tipper signs only as token owner.
    const deposit = await delegateSpl(
      tipper.publicKey,
      mint.publicKey,
      5_000_000n,
      {
        payer: sponsor.publicKey,
        validator,
        private: false,
        initIfMissing: true,
        initAtasIfMissing: true,
        initVaultIfMissing: true,
      },
    );
    await provider.sendAndConfirm(
      new Transaction().add(...deposit),
      [sponsor, tipper],
      {
        skipPreflight: true,
      },
    );
    await waitFor(
      async () => (await erTokenBalance(tipper.publicKey)) === 5_000_000n,
      "the tipper's deposit to reach the ER",
    );
  });

  it("tips on the ER from a wallet with zero SOL", async () => {
    const ix = await program.methods
      .tip(new BN(2_000_000))
      .accountsPartial({
        tipper: tipper.publicKey,
        tipperToken: tokenAccount(tipper.publicKey),
        jar,
        jarToken: tokenAccount(jar),
      })
      .instruction();
    await sendOnEr(tipper, ix);

    assert.equal(await erTokenBalance(tipper.publicKey), 3_000_000n);
    assert.equal(await erTokenBalance(jar), 2_000_000n);
    assert.equal(await connection.getBalance(tipper.publicKey), 0);
  });

  it("rejects withdrawals by anyone but the authority", async () => {
    const ix = await program.methods
      .withdrawTips(new BN(1))
      .accountsPartial({
        authority: tipper.publicKey,
        jar,
        jarToken: tokenAccount(jar),
        destination: tokenAccount(tipper.publicKey),
      })
      .instruction();
    let error = "";
    try {
      await sendOnEr(tipper, ix);
    } catch (e) {
      error = String(e);
    }
    // 2001 = Anchor's ConstraintHasOne: the jar's `has_one = authority` check.
    assert.include(
      error,
      '"Custom":2001',
      "a non-authority withdrawal must fail",
    );
    assert.equal(await erTokenBalance(jar), 2_000_000n);
  });

  it("lets the authority collect tips on the ER, signed by the jar PDA", async () => {
    const ix = await program.methods
      .withdrawTips(new BN(2_000_000))
      .accountsPartial({
        authority: authority.publicKey,
        jar,
        jarToken: tokenAccount(jar),
        destination: tokenAccount(authority.publicKey),
      })
      .instruction();
    await sendOnEr(authority, ix);

    assert.equal(await erTokenBalance(jar), 0n);
    assert.equal(await erTokenBalance(authority.publicKey), 2_000_000n);
  });

  it("commits the jar's totals back to the base layer", async () => {
    const ix = await program.methods
      .commitJar()
      .accountsPartial({ authority: authority.publicKey, jar })
      .instruction();
    await sendOnEr(authority, ix);

    await waitFor(async () => {
      const saved = await program.account.jar.fetch(jar);
      return (
        saved.tipCount.toNumber() === 1 &&
        saved.totalTipped.toNumber() === 2_000_000
      );
    }, "the commit to reach the base layer");
    assert.equal(await connection.getBalance(authority.publicKey), 0);
  });
});
