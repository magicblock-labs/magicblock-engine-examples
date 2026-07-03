import * as anchor from "@coral-xyz/anchor";
import * as borsh from "@coral-xyz/borsh";
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
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID,
  delegateSpl,
  EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { BN, Idl, Program } from "@coral-xyz/anchor";
import binaryPredictionIdl from "../idl/binary_prediction.json";

export type Direction = "up" | "down";

export type LogEntry = {
  id: number;
  tone: "info" | "success" | "error";
  message: string;
  signature?: string;
};

export type MarketSnapshot = {
  admin: string;
  user: string;
  poolAuthority: string;
  mint?: string;
  pool: string;
  bet: string;
  priceFeed: string;
  userTokens: string;
  poolTokens: string;
  userErTokens: string;
  poolErTokens: string;
  openPrice: string;
  currentPrice: string;
  stake: string;
  expiry: string;
  isOpen: boolean;
};

export type StoredMarket = {
  version: 1;
  adminSecret: number[];
  userSecret: number[];
  poolAuthoritySecret: number[];
  mint?: string;
  userAta?: string;
  poolAta?: string;
};

type ProviderPair = {
  base: anchor.AnchorProvider;
  er: anchor.AnchorProvider;
  program: Program;
  erProgram: Program;
};

export const BASE_ENDPOINT =
  import.meta.env.VITE_PROVIDER_ENDPOINT ?? "http://localhost:8899";
export const ER_ENDPOINT =
  import.meta.env.VITE_EPHEMERAL_PROVIDER_ENDPOINT ?? "http://localhost:7799";
export const ER_WS_ENDPOINT =
  import.meta.env.VITE_EPHEMERAL_WS_ENDPOINT ?? "ws://localhost:7800";
export const VALIDATOR = new PublicKey(
  import.meta.env.VITE_VALIDATOR ??
    "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
);

const STORAGE_KEY = "binaryPredictionMarketV1";
const ORACLE_PROGRAM_ID = new PublicKey(
  "PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd",
);
const POOL_SEED = Buffer.from("pool");
const BET_SEED = Buffer.from("bet");
const PRICE_FEED_SEED = Buffer.from("price_feed");
const ORACLE_PROVIDER = "pyth-lazer";
const ORACLE_SYMBOL = "6";

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

class KeypairWallet implements anchor.Wallet {
  constructor(readonly payer: Keypair) {}

  get publicKey() {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    if (transaction instanceof VersionedTransaction) {
      transaction.sign([this.payer]);
    } else {
      transaction.partialSign(this.payer);
    }
    return transaction;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    return Promise.all(
      transactions.map((transaction) => this.signTransaction(transaction)),
    );
  }
}

export function shortKey(value?: string | PublicKey | null) {
  if (!value) return "-";
  const text = typeof value === "string" ? value : value.toBase58();
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function loadOrCreateMarket(): StoredMarket {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return JSON.parse(stored) as StoredMarket;

  const market: StoredMarket = {
    version: 1,
    adminSecret: Array.from(Keypair.generate().secretKey),
    userSecret: Array.from(Keypair.generate().secretKey),
    poolAuthoritySecret: Array.from(Keypair.generate().secretKey),
  };
  saveMarket(market);
  return market;
}

export function saveMarket(market: StoredMarket) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(market));
}

export function resetStoredMarket() {
  localStorage.removeItem(STORAGE_KEY);
}

export function keypairs(market: StoredMarket) {
  return {
    admin: Keypair.fromSecretKey(Uint8Array.from(market.adminSecret)),
    user: Keypair.fromSecretKey(Uint8Array.from(market.userSecret)),
    poolAuthority: Keypair.fromSecretKey(
      Uint8Array.from(market.poolAuthoritySecret),
    ),
  };
}

export function pda(seeds: Buffer[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

export function priceFeed(): PublicKey {
  return pda(
    [PRICE_FEED_SEED, Buffer.from(ORACLE_PROVIDER), Buffer.from(ORACLE_SYMBOL)],
    ORACLE_PROGRAM_ID,
  );
}

export function poolPda(programId: PublicKey): PublicKey {
  return pda([POOL_SEED], programId);
}

export function betPda(programId: PublicKey, user: PublicKey): PublicKey {
  return pda([BET_SEED, user.toBuffer()], programId);
}

export function eata(owner: PublicKey, mint: PublicKey): PublicKey {
  return pda(
    [owner.toBuffer(), mint.toBuffer()],
    EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  );
}

export function vault(mint: PublicKey): PublicKey {
  return pda([mint.toBuffer()], EPHEMERAL_SPL_TOKEN_PROGRAM_ID);
}

export function delegationBuffer(
  account: PublicKey,
  ownerProgram: PublicKey,
): PublicKey {
  return pda([Buffer.from("buffer"), account.toBuffer()], ownerProgram);
}

export function delegationRecord(account: PublicKey): PublicKey {
  return pda(
    [Buffer.from("delegation"), account.toBuffer()],
    DELEGATION_PROGRAM_ID,
  );
}

export function delegationMetadata(account: PublicKey): PublicKey {
  return pda(
    [Buffer.from("delegation-metadata"), account.toBuffer()],
    DELEGATION_PROGRAM_ID,
  );
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

function updateData(symbol: string, feed: PublicKey, price: number) {
  return {
    symbol,
    id: Array.from(feed.toBytes()),
    temporalNumericValue: {
      timestampNs: new BN(Date.now().toString()).mul(new BN(1_000_000)),
      quantizedValue: new BN(price),
    },
    publisherMerkleRoot: Array(32).fill(0),
    valueComputeAlgHash: Array(32).fill(0),
    r: Array(32).fill(0),
    s: Array(32).fill(0),
    v: 0,
  };
}

export function initializePriceFeedIx(
  payer: PublicKey,
  feed: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ORACLE_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: feed, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
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

export function updatePriceFeedIx(
  payer: PublicKey,
  feed: PublicKey,
  price: number,
): TransactionInstruction {
  return new TransactionInstruction({
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

export function delegatePriceFeedIx(
  payer: PublicKey,
  feed: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
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
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeInstruction(
      DELEGATE_PRICE_FEED_DISCRIMINATOR,
      delegatePriceFeedLayout,
      { provider: ORACLE_PROVIDER, symbol: ORACLE_SYMBOL },
    ),
  });
}

export function providers(market: StoredMarket): ProviderPair {
  const { admin } = keypairs(market);
  const wallet = new KeypairWallet(admin);
  const base = new anchor.AnchorProvider(
    new Connection(BASE_ENDPOINT, "confirmed"),
    wallet,
    anchor.AnchorProvider.defaultOptions(),
  );
  const er = new anchor.AnchorProvider(
    new Connection(ER_ENDPOINT, {
      commitment: "confirmed",
      wsEndpoint: ER_WS_ENDPOINT,
    }),
    wallet,
    anchor.AnchorProvider.defaultOptions(),
  );
  const program = new Program(binaryPredictionIdl as Idl, base);
  const erProgram = new Program(binaryPredictionIdl as Idl, er);

  return { base, er, program, erProgram };
}

async function maybeAirdrop(connection: Connection, publicKey: PublicKey) {
  const balance = await connection.getBalance(publicKey, "confirmed");
  if (balance > 0.25 * anchor.web3.LAMPORTS_PER_SOL) return;
  const signature = await connection.requestAirdrop(
    publicKey,
    anchor.web3.LAMPORTS_PER_SOL,
  );
  await connection.confirmTransaction(signature, "confirmed");
}

export async function bootstrapMarket(
  market: StoredMarket,
  options: {
    seedAmount: number;
    userAmount: number;
    durationSeconds: number;
    minStake: number;
    payoutBps: number;
    price: number;
    onLog: (entry: Omit<LogEntry, "id">) => void;
  },
): Promise<StoredMarket> {
  const nextMarket = { ...market };
  const { admin, user, poolAuthority } = keypairs(nextMarket);
  const { base, program } = providers(nextMarket);
  const pool = poolPda(program.programId);
  const feed = priceFeed();

  options.onLog({ tone: "info", message: "Funding local operator wallets" });
  await Promise.all([
    maybeAirdrop(base.connection, admin.publicKey),
    maybeAirdrop(base.connection, user.publicKey),
    maybeAirdrop(base.connection, poolAuthority.publicKey),
  ]);

  options.onLog({ tone: "info", message: "Creating prediction token mint" });
  const mint = await createMint(
    base.connection,
    admin,
    admin.publicKey,
    null,
    0,
  );
  const userAta = await createAssociatedTokenAccount(
    base.connection,
    admin,
    mint,
    user.publicKey,
  );
  const adminAta = await createAssociatedTokenAccount(
    base.connection,
    admin,
    mint,
    admin.publicKey,
  );
  const poolAta = getAssociatedTokenAddressSync(mint, poolAuthority.publicKey);
  const poolEata = eata(poolAuthority.publicKey, mint);
  const vaultPda = vault(mint);
  const vaultEata = eata(vaultPda, mint);
  const vaultAta = getAssociatedTokenAddressSync(mint, vaultPda, true);

  await mintTo(
    base.connection,
    admin,
    mint,
    userAta,
    admin,
    options.userAmount,
  );
  await mintTo(
    base.connection,
    admin,
    mint,
    adminAta,
    admin,
    options.seedAmount,
  );

  options.onLog({ tone: "info", message: "Initializing oracle fixture" });
  await base.sendAndConfirm(
    new Transaction().add(initializePriceFeedIx(admin.publicKey, feed)),
    [],
    { commitment: "confirmed", skipPreflight: true },
  );
  await base.sendAndConfirm(
    new Transaction().add(
      updatePriceFeedIx(admin.publicKey, feed, options.price),
    ),
    [],
    { commitment: "confirmed", skipPreflight: true },
  );

  options.onLog({ tone: "info", message: "Seeding prediction pool" });
  await (program as any).methods
    .initialize(
      feed,
      Array.from(feed.toBytes()),
      new BN(options.seedAmount),
      new BN(options.durationSeconds),
      new BN(options.minStake),
      new BN(options.payoutBps),
    )
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
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
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([
      { pubkey: VALIDATOR, isSigner: false, isWritable: false },
    ])
    .signers([poolAuthority])
    .rpc({ skipPreflight: true });

  options.onLog({ tone: "info", message: "Preparing user bet account" });
  const bet = betPda(program.programId, user.publicKey);
  await (program as any).methods
    .initializeBet()
    .accountsPartial({
      payer: admin.publicKey,
      user: user.publicKey,
      bet,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ skipPreflight: false });

  await base.sendAndConfirm(
    new Transaction().add(delegatePriceFeedIx(admin.publicKey, feed)),
    [],
    { commitment: "confirmed", skipPreflight: true },
  );
  await (program as any).methods
    .delegateBet()
    .accountsPartial({
      payer: admin.publicKey,
      user: user.publicKey,
      bet,
    })
    .remainingAccounts([
      { pubkey: VALIDATOR, isSigner: false, isWritable: false },
    ])
    .signers([user])
    .rpc({ skipPreflight: true });

  const delegateUserIxs = await delegateSpl(
    user.publicKey,
    mint,
    BigInt(options.userAmount),
    {
      validator: VALIDATOR,
      idempotent: false,
      initVaultIfMissing: false,
      payer: admin.publicKey,
    },
  );
  await base.sendAndConfirm(new Transaction().add(...delegateUserIxs), [user], {
    commitment: "confirmed",
    skipPreflight: true,
  });

  nextMarket.mint = mint.toBase58();
  nextMarket.userAta = userAta.toBase58();
  nextMarket.poolAta = poolAta.toBase58();
  saveMarket(nextMarket);
  options.onLog({ tone: "success", message: "Market is ready" });
  return nextMarket;
}

export async function approveMarket(
  market: StoredMarket,
  stakeAllowance: number,
): Promise<void> {
  if (!market.mint || !market.userAta || !market.poolAta) {
    throw new Error("Market setup is incomplete");
  }
  const { user, poolAuthority } = keypairs(market);
  const { er, program } = providers(market);
  const pool = poolPda(program.programId);

  await er.sendAndConfirm(
    new Transaction().add(
      createApproveInstruction(
        new PublicKey(market.poolAta),
        pool,
        poolAuthority.publicKey,
        BigInt(stakeAllowance * 20),
      ),
      createApproveInstruction(
        new PublicKey(market.userAta),
        pool,
        user.publicKey,
        BigInt(stakeAllowance * 2),
      ),
    ),
    [poolAuthority, user],
    { commitment: "confirmed", skipPreflight: true },
  );
}

export async function placeBet(
  market: StoredMarket,
  direction: Direction,
  stake: number,
): Promise<string> {
  if (!market.userAta || !market.poolAta) {
    throw new Error("Market setup is incomplete");
  }
  const { user } = keypairs(market);
  const { erProgram } = providers(market);
  const pool = poolPda(erProgram.programId);
  const bet = betPda(erProgram.programId, user.publicKey);

  return await (erProgram as any).methods
    .placeBet(direction === "up" ? { up: {} } : { down: {} }, new BN(stake))
    .accountsPartial({
      payer: user.publicKey,
      user: user.publicKey,
      pool,
      bet,
      userTokenAccount: new PublicKey(market.userAta),
      poolTokenAccount: new PublicKey(market.poolAta),
      priceUpdate: priceFeed(),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([user])
    .rpc({ skipPreflight: true });
}

export async function settleBet(
  market: StoredMarket,
  settlementPrice: number,
): Promise<string> {
  if (!market.userAta || !market.poolAta) {
    throw new Error("Market setup is incomplete");
  }
  const { admin, user } = keypairs(market);
  const { er, erProgram } = providers(market);
  const pool = poolPda(erProgram.programId);
  const bet = betPda(erProgram.programId, user.publicKey);
  await er.sendAndConfirm(
    new Transaction().add(
      updatePriceFeedIx(admin.publicKey, priceFeed(), settlementPrice),
    ),
    [],
    { commitment: "confirmed", skipPreflight: true },
  );

  return await (erProgram as any).methods
    .settle()
    .accountsPartial({
      payer: admin.publicKey,
      user: user.publicKey,
      pool,
      bet,
      userTokenAccount: new PublicKey(market.userAta),
      poolTokenAccount: new PublicKey(market.poolAta),
      priceUpdate: priceFeed(),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc({ skipPreflight: true });
}

export async function refreshSnapshot(
  market: StoredMarket,
): Promise<MarketSnapshot> {
  const { admin, user, poolAuthority } = keypairs(market);
  const { base, er, erProgram, program } = providers(market);
  const pool = poolPda(program.programId);
  const bet = betPda(program.programId, user.publicKey);
  const feed = priceFeed();
  const mint = market.mint ? new PublicKey(market.mint) : undefined;
  const userAta =
    market.userAta ??
    (mint ? getAssociatedTokenAddressSync(mint, user.publicKey) : undefined);
  const poolAta =
    market.poolAta ??
    (mint
      ? getAssociatedTokenAddressSync(mint, poolAuthority.publicKey)
      : undefined);

  let userTokens = "-";
  let poolTokens = "-";
  if (userAta) {
    try {
      userTokens = (
        await getAccount(er.connection, new PublicKey(userAta))
      ).amount.toString();
    } catch {
      try {
        userTokens = (
          await getAccount(base.connection, new PublicKey(userAta))
        ).amount.toString();
      } catch {
        userTokens = "0";
      }
    }
  }
  if (poolAta) {
    try {
      poolTokens = (
        await getAccount(er.connection, new PublicKey(poolAta))
      ).amount.toString();
    } catch {
      try {
        poolTokens = (
          await getAccount(base.connection, new PublicKey(poolAta))
        ).amount.toString();
      } catch {
        poolTokens = "0";
      }
    }
  }

  let openPrice = "-";
  let stake = "-";
  let expiry = "-";
  let isOpen = false;
  try {
    const account = await (erProgram as any).account.bet.fetch(bet);
    openPrice = account.openPrice.toString();
    stake = account.stake.toString();
    expiry = account.expiryTs.toString();
    isOpen = Boolean(account.isOpen);
  } catch {
    // Bet account has not been initialized or delegated yet.
  }

  return {
    admin: admin.publicKey.toBase58(),
    user: user.publicKey.toBase58(),
    poolAuthority: poolAuthority.publicKey.toBase58(),
    mint: market.mint,
    pool: pool.toBase58(),
    bet: bet.toBase58(),
    priceFeed: feed.toBase58(),
    userTokens,
    poolTokens,
    userErTokens: market.userAta ? shortKey(market.userAta) : "-",
    poolErTokens: market.poolAta ? shortKey(market.poolAta) : "-",
    openPrice,
    currentPrice: "-",
    stake,
    expiry,
    isOpen,
  };
}
