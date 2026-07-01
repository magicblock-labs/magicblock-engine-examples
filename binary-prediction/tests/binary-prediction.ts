import * as anchor from "@coral-xyz/anchor";
import * as borsh from "@coral-xyz/borsh";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createApproveInstruction,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  DELEGATION_PROGRAM_ID,
  delegateSpl,
  EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  undelegateIx,
  withdrawSpl,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { expect } from "chai";

import { BinaryPrediction } from "../target/types/binary_prediction";

const ORACLE_PROGRAM_ID = new web3.PublicKey(
  "PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd",
);
const POOL_SEED = Buffer.from("pool");
const BET_SEED = Buffer.from("bet");
const PRICE_FEED_SEED = Buffer.from("price_feed");
const ORACLE_PROVIDER = "pyth-lazer";
const ORACLE_SYMBOL = "6";
const STAKE = new BN(100);
const USER_DELEGATION = 300n;
const POOL_SEED_AMOUNT = new BN(10_000);
const BET_DURATION_SECONDS = new BN(5);
const MIN_STAKE = new BN(10);
const PAYOUT_BPS = new BN(19_000);
const BET_DURATION_MS = 6_000;

const INITIALIZE_PRICE_FEED_DISCRIMINATOR = Buffer.from([
  68, 180, 81, 20, 102, 213, 145, 233,
]);
const UPDATE_PRICE_FEED_DISCRIMINATOR = Buffer.from([
  28, 9, 93, 150, 86, 153, 188, 115,
]);
const DELEGATE_PRICE_FEED_DISCRIMINATOR = Buffer.from([
  15, 179, 172, 145, 42, 73, 160, 241,
]);
const SCHEDULED_COMMIT_PREFIX = "ScheduledCommitSent signature: ";
const COMMIT_PREFIX = "ScheduledCommitSent signature[0]: ";

const initializePriceFeedLayout = borsh.struct([
  borsh.str("provider"),
  borsh.str("symbol"),
  borsh.array(borsh.u8(), 32, "feedId"),
  borsh.i32("exponent"),
]);
const updatePriceFeedLayout = borsh.struct([
  borsh.str("provider"),
  borsh.struct(
    [
      borsh.str("symbol"),
      borsh.array(borsh.u8(), 32, "id"),
      borsh.struct(
        [borsh.u64("timestampNs"), borsh.i128("quantizedValue")],
        "temporalNumericValue",
      ),
      borsh.array(borsh.u8(), 32, "publisherMerkleRoot"),
      borsh.array(borsh.u8(), 32, "valueComputeAlgHash"),
      borsh.array(borsh.u8(), 32, "r"),
      borsh.array(borsh.u8(), 32, "s"),
      borsh.u8("v"),
    ],
    "updateData",
  ),
]);
const delegatePriceFeedLayout = borsh.struct([
  borsh.str("provider"),
  borsh.str("symbol"),
]);

function pda(seeds: Buffer[], programId: web3.PublicKey): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function eata(owner: web3.PublicKey, mint: web3.PublicKey): web3.PublicKey {
  return pda(
    [owner.toBuffer(), mint.toBuffer()],
    EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  );
}

function vault(mint: web3.PublicKey): web3.PublicKey {
  return pda([mint.toBuffer()], EPHEMERAL_SPL_TOKEN_PROGRAM_ID);
}

function delegationBuffer(
  account: web3.PublicKey,
  ownerProgram: web3.PublicKey,
): web3.PublicKey {
  return pda([Buffer.from("buffer"), account.toBuffer()], ownerProgram);
}

function delegationRecord(account: web3.PublicKey): web3.PublicKey {
  return pda(
    [Buffer.from("delegation"), account.toBuffer()],
    DELEGATION_PROGRAM_ID,
  );
}

function delegationMetadata(account: web3.PublicKey): web3.PublicKey {
  return pda(
    [Buffer.from("delegation-metadata"), account.toBuffer()],
    DELEGATION_PROGRAM_ID,
  );
}

function priceFeed(): web3.PublicKey {
  return pda(
    [PRICE_FEED_SEED, Buffer.from(ORACLE_PROVIDER), Buffer.from(ORACLE_SYMBOL)],
    ORACLE_PROGRAM_ID,
  );
}

function betPda(
  programId: web3.PublicKey,
  user: web3.PublicKey,
): web3.PublicKey {
  return pda([BET_SEED, user.toBuffer()], programId);
}

function encodeInstruction(
  discriminator: Buffer,
  layout: borsh.Layout<unknown>,
  value: unknown,
): Buffer {
  const encoded = Buffer.alloc(1_000);
  const span = layout.encode(value, encoded);

  return Buffer.concat([discriminator, encoded.subarray(0, span)]);
}

function initializePriceFeedIx(
  payer: web3.PublicKey,
  feed: web3.PublicKey,
): web3.TransactionInstruction {
  return new web3.TransactionInstruction({
    programId: ORACLE_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: feed, isSigner: false, isWritable: true },
      {
        pubkey: web3.SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
    ],
    data: encodeInstruction(
      INITIALIZE_PRICE_FEED_DISCRIMINATOR,
      initializePriceFeedLayout,
      {
        provider: ORACLE_PROVIDER,
        symbol: ORACLE_SYMBOL,
        feedId: Array.from(feed.toBytes()),
        exponent: 0,
      },
    ),
  });
}

function updatePriceFeedIx(
  payer: web3.PublicKey,
  feed: web3.PublicKey,
  price: number,
): web3.TransactionInstruction {
  return new web3.TransactionInstruction({
    programId: ORACLE_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: feed, isSigner: false, isWritable: true },
    ],
    data: encodeInstruction(
      UPDATE_PRICE_FEED_DISCRIMINATOR,
      updatePriceFeedLayout,
      {
        provider: ORACLE_PROVIDER,
        updateData: updateData(ORACLE_SYMBOL, feed, price),
      },
    ),
  });
}

function delegatePriceFeedIx(
  payer: web3.PublicKey,
  feed: web3.PublicKey,
): web3.TransactionInstruction {
  return new web3.TransactionInstruction({
    programId: ORACLE_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: feed, isSigner: false, isWritable: true },
      {
        pubkey: delegationBuffer(feed, ORACLE_PROGRAM_ID),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: delegationRecord(feed), isSigner: false, isWritable: true },
      { pubkey: delegationMetadata(feed), isSigner: false, isWritable: true },
      { pubkey: ORACLE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false },
      {
        pubkey: web3.SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
    ],
    data: encodeInstruction(
      DELEGATE_PRICE_FEED_DISCRIMINATOR,
      delegatePriceFeedLayout,
      {
        provider: ORACLE_PROVIDER,
        symbol: ORACLE_SYMBOL,
      },
    ),
  });
}

function updateData(symbol: string, feed: web3.PublicKey, price: number) {
  return {
    symbol,
    id: Array.from(feed.toBytes()),
    temporalNumericValue: {
      timestampNs: new BN(Date.now()),
      quantizedValue: new BN(price),
    },
    publisherMerkleRoot: Array(32).fill(0),
    valueComputeAlgHash: Array(32).fill(0),
    r: Array(32).fill(0),
    s: Array(32).fill(0),
    v: 0,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function findLogValue(logMessages: string[], prefix: string): string | null {
  const message = logMessages.find((log) => log.includes(prefix));

  return message ? message.split(prefix)[1] : null;
}

function dumpLogs(label: string, logMessages: string[]): void {
  console.log(`${label} logs:`);
  for (const log of logMessages) {
    console.log(`  ${log}`);
  }
}

async function getCommitmentSignatureWithLogs(
  label: string,
  transactionSignature: string,
  ephemeralConnection: web3.Connection,
): Promise<string> {
  const schedulingTransaction = await ephemeralConnection.getTransaction(
    transactionSignature,
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
  );
  if (!schedulingTransaction?.meta) {
    throw new Error(`${label}: scheduling transaction not found`);
  }

  const schedulingLogs = schedulingTransaction.meta.logMessages ?? [];
  dumpLogs(
    `${label} scheduling transaction ${transactionSignature}`,
    schedulingLogs,
  );

  const scheduledCommitSignature = findLogValue(
    schedulingLogs,
    SCHEDULED_COMMIT_PREFIX,
  );
  if (!scheduledCommitSignature) {
    throw new Error(`${label}: scheduled commit signature not found`);
  }
  console.log(`${label} scheduled commit: ${scheduledCommitSignature}`);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const scheduledTransaction = await ephemeralConnection.getTransaction(
      scheduledCommitSignature,
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );
    if (scheduledTransaction?.meta) {
      const scheduledLogs = scheduledTransaction.meta.logMessages ?? [];
      dumpLogs(
        `${label} scheduled commit transaction ${scheduledCommitSignature}`,
        scheduledLogs,
      );

      const commitmentSignature = findLogValue(scheduledLogs, COMMIT_PREFIX);
      if (!commitmentSignature) {
        throw new Error(`${label}: base commitment signature not found`);
      }

      return commitmentSignature;
    }
    await sleep(1_000);
  }

  throw new Error(
    `${label}: scheduled commit transaction ${scheduledCommitSignature} did not land`,
  );
}

describe("binary-prediction", () => {
  const provider = process.env.PROVIDER_ENDPOINT
    ? new anchor.AnchorProvider(
        new anchor.web3.Connection(process.env.PROVIDER_ENDPOINT, "confirmed"),
        anchor.Wallet.local(),
      )
    : anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const erProvider = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT || "http://localhost:7799",
      {
        wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "ws://localhost:7800",
        commitment: "confirmed",
      },
    ),
    anchor.Wallet.local(),
  );

  const program = anchor.workspace
    .BinaryPrediction as Program<BinaryPrediction>;
  const erProgram = new Program(
    program.idl,
    erProvider,
  ) as Program<BinaryPrediction>;

  const admin = (provider.wallet as anchor.Wallet).payer;
  const user = web3.Keypair.generate();
  const poolAuthority = web3.Keypair.generate();
  const sessionKeypair = web3.Keypair.generate();
  const feed = priceFeed();
  const [pool] = web3.PublicKey.findProgramAddressSync(
    [POOL_SEED],
    program.programId,
  );
  const userBet = betPda(program.programId, user.publicKey);

  let mint: web3.PublicKey;
  let userAta: web3.PublicKey;
  let poolAta: web3.PublicKey;
  let poolEata: web3.PublicKey;
  let vaultPda: web3.PublicKey;
  let vaultEata: web3.PublicKey;
  let vaultAta: web3.PublicKey;
  let sessionTokenPda: web3.PublicKey;

  it("runs initialize -> bet -> settle -> user withdraw", async () => {
    mint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      0,
    );
    userAta = await createAssociatedTokenAccount(
      provider.connection,
      admin,
      mint,
      user.publicKey,
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: poolAuthority.publicKey,
          lamports: web3.LAMPORTS_PER_SOL,
        }),
      ),
      [admin],
      { commitment: "confirmed", skipPreflight: true },
    );
    poolAta = getAssociatedTokenAddressSync(mint, poolAuthority.publicKey);
    poolEata = eata(poolAuthority.publicKey, mint);
    vaultPda = vault(mint);
    vaultEata = eata(vaultPda, mint);
    vaultAta = getAssociatedTokenAddressSync(mint, vaultPda, true);

    await mintTo(provider.connection, admin, mint, userAta, admin, 1_000n);
    const adminAta = await createAssociatedTokenAccount(
      provider.connection,
      admin,
      mint,
      admin.publicKey,
    );
    await mintTo(
      provider.connection,
      admin,
      mint,
      adminAta,
      admin,
      BigInt(POOL_SEED_AMOUNT.toString()),
    );

    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        initializePriceFeedIx(admin.publicKey, feed),
      ),
      [admin],
      { commitment: "confirmed", skipPreflight: true },
    );

    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        updatePriceFeedIx(admin.publicKey, feed, 100),
      ),
      [admin],
      { commitment: "confirmed", skipPreflight: true },
    );

    const validator = new web3.PublicKey(
      process.env.VALIDATOR ?? "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
    );

    await program.methods
      .initialize(
        feed,
        POOL_SEED_AMOUNT,
        BET_DURATION_SECONDS,
        MIN_STAKE,
        PAYOUT_BPS,
      )
      .preInstructions([
        web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .accountsPartial({
        admin: admin.publicKey,
        mint,
        pool,
        poolTokenAccount: poolAta,
        poolAuthority: poolAuthority.publicKey,
        adminTokenAccount: adminAta,
        poolEphemeralAta: poolEata,
        vault: vaultPda,
        vaultEphemeralAta: vaultEata,
        vaultTokenAccount: vaultAta,
        poolEataBuffer: delegationBuffer(
          poolEata,
          EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        ),
        poolEataRecord: delegationRecord(poolEata),
        poolEataMetadata: delegationMetadata(poolEata),
        vaultEataBuffer: delegationBuffer(
          vaultEata,
          EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        ),
        vaultEataRecord: delegationRecord(vaultEata),
        vaultEataMetadata: delegationMetadata(vaultEata),
        ephemeralTokenProgram: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: validator, isSigner: false, isWritable: false },
      ])
      .signers([admin, poolAuthority])
      .rpc({ skipPreflight: true });

    const poolState = await program.account.pool.fetch(pool);
    expect(poolState.betDurationSeconds.toNumber()).to.equal(
      BET_DURATION_SECONDS.toNumber(),
    );
    expect(poolState.minStake.toNumber()).to.equal(MIN_STAKE.toNumber());
    expect(poolState.payoutBps.toNumber()).to.equal(PAYOUT_BPS.toNumber());
    expect((await getAccount(provider.connection, poolAta)).amount).to.equal(
      0n,
    );

    await program.methods
      .initializeBet()
      .accountsPartial({
        payer: admin.publicKey,
        user: user.publicKey,
        bet: userBet,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc({ skipPreflight: false });

    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        delegatePriceFeedIx(admin.publicKey, feed),
      ),
      [admin],
      { commitment: "confirmed", skipPreflight: true },
    );

    await program.methods
      .delegateBet()
      .accountsPartial({
        payer: admin.publicKey,
        user: user.publicKey,
        bet: userBet,
      })
      .remainingAccounts([
        { pubkey: validator, isSigner: false, isWritable: false },
      ])
      .signers([admin, user])
      .rpc({ skipPreflight: true });

    const delegateUserIxs = await delegateSpl(
      user.publicKey,
      mint,
      USER_DELEGATION,
      {
        validator,
        idempotent: false,
        initVaultIfMissing: false,
        payer: admin.publicKey,
      },
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(...delegateUserIxs),
      [user, admin],
      { commitment: "confirmed", skipPreflight: true },
    );

    await sleep(3_000);

    const sessionTokenManager = new SessionTokenManager(
      provider.wallet,
      provider.connection,
    );
    sessionTokenPda = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("session_token_v2"),
        program.programId.toBuffer(),
        sessionKeypair.publicKey.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      sessionTokenManager.program.programId,
    )[0];
    await sessionTokenManager.program.methods
      .createSessionV2(
        true,
        new BN(Math.floor(Date.now() / 1000) + 3600),
        new BN(0.005 * web3.LAMPORTS_PER_SOL),
      )
      .accounts({
        targetProgram: program.programId,
        sessionSigner: sessionKeypair.publicKey,
        feePayer: admin.publicKey,
        authority: user.publicKey,
      })
      .signers([admin, user, sessionKeypair])
      .rpc({ skipPreflight: true });

    await erProvider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        createApproveInstruction(
          poolAta,
          pool,
          poolAuthority.publicKey,
          BigInt(POOL_SEED_AMOUNT.toString()),
        ),
        createApproveInstruction(
          userAta,
          pool,
          user.publicKey,
          2n * BigInt(STAKE.toString()),
        ),
      ),
      [admin, poolAuthority, user],
      { commitment: "confirmed", skipPreflight: true },
    );

    await erProgram.methods
      .placeBet({ up: {} }, STAKE)
      .accountsPartial({
        payer: sessionKeypair.publicKey,
        user: user.publicKey,
        pool,
        bet: userBet,
        userTokenAccount: userAta,
        poolTokenAccount: poolAta,
        priceUpdate: feed,
        tokenProgram: TOKEN_PROGRAM_ID,
        sessionToken: sessionTokenPda,
      })
      .signers([sessionKeypair])
      .rpc({ skipPreflight: true });

    let bet = await erProgram.account.bet.fetch(userBet);
    expect(bet.openPrice.toNumber()).to.equal(100);
    expect(bet.stake.toNumber()).to.equal(STAKE.toNumber());
    expect(bet.isOpen).to.equal(true);

    await erProvider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        updatePriceFeedIx(admin.publicKey, feed, 110),
      ),
      [admin],
      { commitment: "confirmed", skipPreflight: true },
    );
    await sleep(BET_DURATION_MS);

    await erProgram.methods
      .settle()
      .accountsPartial({
        payer: admin.publicKey,
        user: user.publicKey,
        pool,
        bet: userBet,
        userTokenAccount: userAta,
        poolTokenAccount: poolAta,
        priceUpdate: feed,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc({ skipPreflight: true });

    bet = await erProgram.account.bet.fetch(userBet);
    expect(bet.isOpen).to.equal(false);

    await erProgram.methods
      .placeBet({ down: {} }, STAKE)
      .accountsPartial({
        payer: sessionKeypair.publicKey,
        user: user.publicKey,
        pool,
        bet: userBet,
        userTokenAccount: userAta,
        poolTokenAccount: poolAta,
        priceUpdate: feed,
        tokenProgram: TOKEN_PROGRAM_ID,
        sessionToken: sessionTokenPda,
      })
      .signers([sessionKeypair])
      .rpc({ skipPreflight: true });

    await erProvider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        updatePriceFeedIx(admin.publicKey, feed, 120),
      ),
      [admin],
      { commitment: "confirmed", skipPreflight: true },
    );
    await sleep(BET_DURATION_MS);

    await erProgram.methods
      .settle()
      .accountsPartial({
        payer: admin.publicKey,
        user: user.publicKey,
        pool,
        bet: userBet,
        userTokenAccount: userAta,
        poolTokenAccount: poolAta,
        priceUpdate: feed,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc({ skipPreflight: true });

    const erUserBalance = (await getAccount(erProvider.connection, userAta))
      .amount;
    const erPoolBalance = (await getAccount(erProvider.connection, poolAta))
      .amount;
    expect(erUserBalance).to.equal(290n);
    expect(erPoolBalance).to.equal(10_010n);

    const userUndelegateSig = await erProvider.sendAndConfirm(
      new anchor.web3.Transaction().add(undelegateIx(user.publicKey, mint)),
      [user],
      { commitment: "confirmed", skipPreflight: true },
    );

    await provider.connection.confirmTransaction(
      await getCommitmentSignatureWithLogs(
        "user undelegate",
        userUndelegateSig,
        erProvider.connection,
      ),
      "confirmed",
    );

    const userWithdrawIxs = await withdrawSpl(
      user.publicKey,
      mint,
      erUserBalance,
      {
        idempotent: false,
      },
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(...userWithdrawIxs),
      [user],
      { commitment: "confirmed", skipPreflight: true },
    );

    expect((await getAccount(provider.connection, userAta)).amount).to.equal(
      990n,
    );
    expect((await getAccount(provider.connection, poolAta)).amount).to.equal(
      0n,
    );
  });
});
