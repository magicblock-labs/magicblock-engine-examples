import * as anchor from "@coral-xyz/anchor";
import * as borsh from "@coral-xyz/borsh";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createApproveInstruction,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
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
import { MagicSVM } from "@magicblock-labs/magicsvm";
import { airdropOrThrow, sendSvmTx } from "@magicblock-labs/test-utils";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

import { BinaryPrediction } from "../target/types/binary_prediction";

const ORACLE_PROGRAM_ID = new web3.PublicKey(
  "PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd",
);
const SESSION_PROGRAM_ID = new web3.PublicKey(
  "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5",
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
const MINT_SIZE = 82;

const INITIALIZE_PRICE_FEED_DISCRIMINATOR = Buffer.from([
  68, 180, 81, 20, 102, 213, 145, 233,
]);
const UPDATE_PRICE_FEED_DISCRIMINATOR = Buffer.from([
  28, 9, 93, 150, 86, 153, 188, 115,
]);
const DELEGATE_PRICE_FEED_DISCRIMINATOR = Buffer.from([
  15, 179, 172, 145, 42, 73, 160, 241,
]);

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
  timestampNs: BN,
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
        updateData: {
          symbol: ORACLE_SYMBOL,
          id: Array.from(feed.toBytes()),
          temporalNumericValue: {
            timestampNs,
            quantizedValue: new BN(price),
          },
          publisherMerkleRoot: Array(32).fill(0),
          valueComputeAlgHash: Array(32).fill(0),
          r: Array(32).fill(0),
          s: Array(32).fill(0),
          v: 0,
        },
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

function tokenAmount(
  svm: MagicSVM,
  address: web3.PublicKey,
  target: "base" | "ephemeral",
): bigint {
  const account = svm.getAccountFor(address, { target });
  expect(account.exists, `token account missing on ${target}`).to.equal(true);
  if (!account.exists) {
    throw new Error(`token account missing on ${target}`);
  }
  return Buffer.from(account.data).readBigUInt64LE(64);
}

function readPool(svm: MagicSVM, pool: web3.PublicKey) {
  const account = svm.getAccount(pool);
  expect(account.exists, "pool missing").to.equal(true);
  if (!account.exists) {
    throw new Error("pool missing");
  }
  const data = Buffer.from(account.data);
  return {
    priceFeedId: data.subarray(104, 136),
    betDurationSeconds: Number(data.readBigInt64LE(136)),
    minStake: Number(data.readBigUInt64LE(144)),
    payoutBps: Number(data.readBigUInt64LE(152)),
  };
}

function readBet(
  svm: MagicSVM,
  bet: web3.PublicKey,
  target: "base" | "ephemeral",
) {
  const account = svm.getAccountFor(bet, { target });
  expect(account.exists, `bet missing on ${target}`).to.equal(true);
  if (!account.exists) {
    throw new Error(`bet missing on ${target}`);
  }
  const data = Buffer.from(account.data);
  return {
    openPrice: Number(data.readBigInt64LE(8)),
    stake: Number(data.readBigUInt64LE(25)),
    isOpen: data[33] === 1,
  };
}

function setUnixTimestamp(svm: MagicSVM, unixTimestamp: bigint) {
  const clock = svm.getClock();
  clock.unixTimestamp = unixTimestamp;
  svm.setClock(clock);
}

function oracleTimestampNs(svm: MagicSVM): BN {
  return new BN(svm.getClock().unixTimestamp.toString()).mul(
    new BN(1_000_000_000),
  );
}

describe("binary-prediction magicsvm", () => {
  const soPath = path.resolve(
    __dirname,
    "..",
    "target",
    "deploy",
    "binary_prediction.so",
  );
  const oracleSoPath = path.resolve(
    __dirname,
    "..",
    "tests",
    "fixtures",
    "ephemeral_oracle.so",
  );
  const sessionSoPath = path.resolve(__dirname, "fixtures", "session-keys.so");
  expect(fs.existsSync(soPath), `missing program binary at ${soPath}`).to.equal(
    true,
  );
  expect(
    fs.existsSync(oracleSoPath),
    `missing oracle program at ${oracleSoPath}`,
  ).to.equal(true);
  expect(
    fs.existsSync(sessionSoPath),
    `missing gum session program at ${sessionSoPath}`,
  ).to.equal(true);

  const idl = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "..", "target", "idl", "binary_prediction.json"),
      "utf8",
    ),
  );
  const admin = web3.Keypair.generate();
  const user = web3.Keypair.generate();
  const sessionKeypair = web3.Keypair.generate();
  const mintKp = web3.Keypair.generate();
  const dummyProvider = new anchor.AnchorProvider(
    new web3.Connection("http://127.0.0.1:8899"),
    new anchor.Wallet(admin),
    { commitment: "confirmed" },
  );
  const program = new Program<BinaryPrediction>(idl, dummyProvider);
  const sessionTokenManager = new SessionTokenManager(
    dummyProvider.wallet,
    dummyProvider.connection,
  );

  const svm = new MagicSVM();
  const now = BigInt(Math.floor(Date.now() / 1000));
  setUnixTimestamp(svm, now);
  svm.addProgramFromFile(program.programId, soPath);
  svm.addProgramFromFile(ORACLE_PROGRAM_ID, oracleSoPath);
  svm.addProgramFromFile(SESSION_PROGRAM_ID, sessionSoPath);
  airdropOrThrow(
    svm,
    admin.publicKey,
    BigInt(10 * web3.LAMPORTS_PER_SOL),
    "airdrop admin",
  );
  airdropOrThrow(
    svm,
    user.publicKey,
    BigInt(2 * web3.LAMPORTS_PER_SOL),
    "airdrop user",
  );

  const validator = new web3.PublicKey(svm.validatorIdentity().toString());
  const feed = priceFeed();
  const feedId = Array.from(feed.toBytes());
  const userBet = betPda(program.programId, user.publicKey);
  const mint = mintKp.publicKey;
  const userAta = getAssociatedTokenAddressSync(mint, user.publicKey);
  const adminAta = getAssociatedTokenAddressSync(mint, admin.publicKey);
  const pool = web3.PublicKey.findProgramAddressSync(
    [POOL_SEED, mint.toBuffer()],
    program.programId,
  )[0];
  const poolAta = getAssociatedTokenAddressSync(mint, pool, true);
  const poolEata = eata(pool, mint);
  const vaultPda = vault(mint);
  const vaultEata = eata(vaultPda, mint);
  const vaultAta = getAssociatedTokenAddressSync(mint, vaultPda, true);
  const sessionTokenPda = web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("session_token_v2"),
      program.programId.toBuffer(),
      sessionKeypair.publicKey.toBuffer(),
      user.publicKey.toBuffer(),
    ],
    sessionTokenManager.program.programId,
  )[0];

  it("runs initialize -> bet -> settle -> user withdraw", async () => {
    const mintRent = Number(
      svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)),
    );
    sendSvmTx(
      svm,
      [admin, mintKp],
      new web3.Transaction().add(
        web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: mint,
          space: MINT_SIZE,
          lamports: mintRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(mint, 0, admin.publicKey, null),
      ),
      "base",
      "create mint",
    );

    sendSvmTx(
      svm,
      [admin],
      new web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          admin.publicKey,
          userAta,
          user.publicKey,
          mint,
        ),
        createAssociatedTokenAccountInstruction(
          admin.publicKey,
          adminAta,
          admin.publicKey,
          mint,
        ),
      ),
      "base",
      "create ATAs",
    );

    sendSvmTx(
      svm,
      [admin],
      new web3.Transaction().add(
        createMintToInstruction(mint, userAta, admin.publicKey, 1_000n),
        createMintToInstruction(
          mint,
          adminAta,
          admin.publicKey,
          BigInt(POOL_SEED_AMOUNT.toString()),
        ),
      ),
      "base",
      "mint tokens",
    );

    sendSvmTx(
      svm,
      [admin],
      new web3.Transaction().add(initializePriceFeedIx(admin.publicKey, feed)),
      "base",
      "initialize price feed",
    );
    sendSvmTx(
      svm,
      [admin],
      new web3.Transaction().add(
        updatePriceFeedIx(admin.publicKey, feed, 100, oracleTimestampNs(svm)),
      ),
      "base",
      "update price feed 100",
    );

    const initializeTx = await program.methods
      .initialize(
        feed,
        feedId,
        POOL_SEED_AMOUNT,
        BET_DURATION_SECONDS,
        MIN_STAKE,
        PAYOUT_BPS,
      )
      .preInstructions([
        web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ])
      .accountsPartial({
        admin: admin.publicKey,
        mint,
        pool,
        poolTokenAccount: poolAta,
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
      .transaction();
    sendSvmTx(svm, [admin], initializeTx, "base", "initialize");

    const poolState = readPool(svm, pool);
    expect(poolState.betDurationSeconds).to.equal(
      BET_DURATION_SECONDS.toNumber(),
    );
    expect(Buffer.from(poolState.priceFeedId)).to.deep.equal(
      Buffer.from(feedId),
    );
    expect(poolState.minStake).to.equal(MIN_STAKE.toNumber());
    expect(poolState.payoutBps).to.equal(PAYOUT_BPS.toNumber());
    expect(tokenAmount(svm, poolAta, "base")).to.equal(0n);

    const initializeBetTx = await program.methods
      .initializeBet()
      .accountsPartial({
        payer: admin.publicKey,
        user: user.publicKey,
        bet: userBet,
        systemProgram: web3.SystemProgram.programId,
      })
      .transaction();
    sendSvmTx(svm, [admin], initializeBetTx, "base", "initialize bet");

    sendSvmTx(
      svm,
      [admin],
      new web3.Transaction().add(delegatePriceFeedIx(admin.publicKey, feed)),
      "base",
      "delegate price feed",
    );

    const delegateBetTx = await program.methods
      .delegateBet()
      .accountsPartial({
        payer: admin.publicKey,
        user: user.publicKey,
        bet: userBet,
      })
      .remainingAccounts([
        { pubkey: validator, isSigner: false, isWritable: false },
      ])
      .transaction();
    sendSvmTx(svm, [admin, user], delegateBetTx, "base", "delegate bet");

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
    sendSvmTx(
      svm,
      [admin, user],
      new web3.Transaction().add(...delegateUserIxs),
      "base",
      "delegate user SPL",
    );

    const placeWalletBetTx = await program.methods
      .placeBet({ up: {} }, STAKE)
      .accountsPartial({
        payer: user.publicKey,
        user: user.publicKey,
        mint,
        pool,
        bet: userBet,
        userTokenAccount: userAta,
        poolTokenAccount: poolAta,
        priceUpdate: feed,
        tokenProgram: TOKEN_PROGRAM_ID,
        sessionToken: null,
      })
      .transaction();
    sendSvmTx(
      svm,
      [admin, user],
      placeWalletBetTx,
      "ephemeral",
      "place wallet bet",
    );

    let bet = readBet(svm, userBet, "ephemeral");
    expect(bet.openPrice).to.equal(100);
    expect(bet.stake).to.equal(STAKE.toNumber());
    expect(bet.isOpen).to.equal(true);

    sendSvmTx(
      svm,
      [admin],
      new web3.Transaction().add(
        updatePriceFeedIx(admin.publicKey, feed, 110, oracleTimestampNs(svm)),
      ),
      "ephemeral",
      "update price feed 110",
    );
    setUnixTimestamp(
      svm,
      svm.getClock().unixTimestamp +
        BigInt(BET_DURATION_SECONDS.toNumber() + 1),
    );

    const settleWinTx = await program.methods
      .settle()
      .accountsPartial({
        payer: admin.publicKey,
        user: user.publicKey,
        mint,
        pool,
        bet: userBet,
        userTokenAccount: userAta,
        poolTokenAccount: poolAta,
        priceUpdate: feed,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
    sendSvmTx(svm, [admin], settleWinTx, "ephemeral", "settle win");

    bet = readBet(svm, userBet, "ephemeral");
    expect(bet.isOpen).to.equal(false);

    const createSessionTx = await sessionTokenManager.program.methods
      .createSessionV2(
        true,
        new BN(Number(svm.getClock().unixTimestamp) + 3600),
        new BN(0.005 * web3.LAMPORTS_PER_SOL),
      )
      .accounts({
        targetProgram: program.programId,
        sessionSigner: sessionKeypair.publicKey,
        feePayer: admin.publicKey,
        authority: user.publicKey,
      })
      .transaction();
    sendSvmTx(
      svm,
      [admin, user, sessionKeypair],
      createSessionTx,
      "base",
      "create session",
    );

    sendSvmTx(
      svm,
      [admin, user],
      new web3.Transaction().add(
        createApproveInstruction(
          userAta,
          sessionKeypair.publicKey,
          user.publicKey,
          BigInt(STAKE.toString()),
        ),
      ),
      "ephemeral",
      "approve session delegate",
    );

    const placeSessionBetTx = await program.methods
      .placeBet({ down: {} }, STAKE)
      .accountsPartial({
        payer: sessionKeypair.publicKey,
        user: user.publicKey,
        mint,
        pool,
        bet: userBet,
        userTokenAccount: userAta,
        poolTokenAccount: poolAta,
        priceUpdate: feed,
        tokenProgram: TOKEN_PROGRAM_ID,
        sessionToken: sessionTokenPda,
      })
      .transaction();
    sendSvmTx(
      svm,
      [sessionKeypair],
      placeSessionBetTx,
      "ephemeral",
      "place session bet",
    );

    sendSvmTx(
      svm,
      [admin],
      new web3.Transaction().add(
        updatePriceFeedIx(admin.publicKey, feed, 120, oracleTimestampNs(svm)),
      ),
      "ephemeral",
      "update price feed 120",
    );
    setUnixTimestamp(
      svm,
      svm.getClock().unixTimestamp +
        BigInt(BET_DURATION_SECONDS.toNumber() + 1),
    );

    const settleLossTx = await program.methods
      .settle()
      .accountsPartial({
        payer: admin.publicKey,
        user: user.publicKey,
        mint,
        pool,
        bet: userBet,
        userTokenAccount: userAta,
        poolTokenAccount: poolAta,
        priceUpdate: feed,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
    sendSvmTx(svm, [admin], settleLossTx, "ephemeral", "settle loss");

    const erUserBalance = tokenAmount(svm, userAta, "ephemeral");
    const erPoolBalance = tokenAmount(svm, poolAta, "ephemeral");
    expect(erUserBalance).to.equal(290n);
    expect(erPoolBalance).to.equal(10_010n);

    sendSvmTx(
      svm,
      [user],
      new web3.Transaction().add(undelegateIx(user.publicKey, mint)),
      "ephemeral",
      "user undelegate",
    );

    const userWithdrawIxs = await withdrawSpl(
      user.publicKey,
      mint,
      erUserBalance,
      {
        idempotent: false,
      },
    );
    sendSvmTx(
      svm,
      [admin, user],
      new web3.Transaction().add(...userWithdrawIxs),
      "base",
      "user withdraw",
    );

    expect(tokenAmount(svm, userAta, "base")).to.equal(990n);
    expect(tokenAmount(svm, poolAta, "base")).to.equal(0n);
  });
});
