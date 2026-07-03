import * as anchor from "@coral-xyz/anchor";
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
  Commitment,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID,
  delegateSpl,
  EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { BN, Idl, Program } from "@coral-xyz/anchor";
import binaryPredictionIdl from "../idl/binary_prediction.json";

export type Direction = "up" | "down";

export type LogEntry = {
  id: number;
  tone: "info" | "success" | "error";
  message: string;
  signature?: string;
};

export type TransactionResult = {
  signature: string;
  sendMs: number;
  confirmMs: number;
  totalMs: number;
  commitment: Commitment;
};

export type MarketSnapshot = {
  admin: string;
  user: string;
  poolAuthority: string;
  sessionSigner: string;
  sessionToken: string;
  sessionValidUntil: string;
  sessionAllowance: string;
  adminSol: string;
  userSol: string;
  poolAuthoritySol: string;
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
  payoutBps: string;
  direction?: Direction;
  stake: string;
  expiry: string;
  isOpen: boolean;
};

export type OraclePrice = {
  raw: string;
  display: string;
  exponent: number;
  publishTime: number;
  slot: string;
};

export type StoredMarket = {
  version: 1;
  adminSecret: number[];
  userSecret: number[];
  poolAuthoritySecret: number[];
  sessionSecret?: number[];
  sessionToken?: string;
  sessionValidUntil?: number;
  sessionAllowance?: number;
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

const MIN_OPERATOR_SOL = 0.25;

export const BASE_ENDPOINT =
  import.meta.env.VITE_PROVIDER_ENDPOINT ?? "https://rpc.magicblock.app/devnet";
export const ER_ENDPOINT =
  import.meta.env.VITE_EPHEMERAL_PROVIDER_ENDPOINT ??
  "https://devnet-as.magicblock.app";
export const ER_WS_ENDPOINT =
  import.meta.env.VITE_EPHEMERAL_WS_ENDPOINT ??
  "wss://devnet-as.magicblock.app";
export const VALIDATOR = new PublicKey(
  import.meta.env.VITE_VALIDATOR ??
    "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
);

const STORAGE_KEY = "binaryPredictionMarketV1";
const SESSION_TOKEN_SEED = Buffer.from("session_token_v2");
export const ORACLE_SYMBOL = "SOL/USD";
export const SOL_PRICE_FEED = new PublicKey(
  "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu",
);
const POOL_SEED = Buffer.from("pool");
const BET_SEED = Buffer.from("bet");

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

function directionFromAccount(value: unknown): Direction | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("up" in value) return "up";
  if ("down" in value) return "down";
  return undefined;
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
    session: market.sessionSecret
      ? Keypair.fromSecretKey(Uint8Array.from(market.sessionSecret))
      : undefined,
  };
}

function withSessionKeypair(market: StoredMarket) {
  const existing = keypairs(market).session;
  if (existing) return { market, session: existing };

  const session = Keypair.generate();
  const nextMarket = {
    ...market,
    sessionSecret: Array.from(session.secretKey),
  };
  saveMarket(nextMarket);
  return { market: nextMarket, session };
}

export function pda(seeds: Buffer[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

export function priceFeed(): PublicKey {
  return SOL_PRICE_FEED;
}

export function poolPda(programId: PublicKey): PublicKey {
  return pda([POOL_SEED], programId);
}

export function betPda(programId: PublicKey, user: PublicKey): PublicKey {
  return pda([BET_SEED, user.toBuffer()], programId);
}

export function sessionTokenPda(
  sessionProgramId: PublicKey,
  targetProgramId: PublicKey,
  sessionSigner: PublicKey,
  authority: PublicKey,
): PublicKey {
  return pda(
    [
      SESSION_TOKEN_SEED,
      targetProgramId.toBuffer(),
      sessionSigner.toBuffer(),
      authority.toBuffer(),
    ],
    sessionProgramId,
  );
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

function formatOraclePrice(raw: bigint, exponent: number) {
  const scale = Math.abs(exponent);
  if (scale === 0) return raw.toString();
  const denominator = 10n ** BigInt(scale);
  const whole = raw / denominator;
  const fraction = (raw % denominator).toString().padStart(scale, "0");
  return `${whole}.${fraction}`.replace(/\.?0+$/, "");
}

export function decodeOraclePrice(data: Buffer): OraclePrice {
  if (data.length < 133) {
    throw new Error("Oracle price account has invalid data");
  }

  // Anchor discriminator + PriceUpdateV2 fields from pyth_solana_receiver_sdk.
  const raw = data.readBigInt64LE(73);
  const exponent = data.readInt32LE(89);
  const publishTime = Number(data.readBigInt64LE(93));
  const slot = data.readBigUInt64LE(125).toString();

  return {
    raw: raw.toString(),
    display: formatOraclePrice(raw, exponent),
    exponent,
    publishTime,
    slot,
  };
}

export async function fetchOraclePrice(): Promise<OraclePrice> {
  const connection = new Connection(ER_ENDPOINT, {
    commitment: "confirmed",
    wsEndpoint: ER_WS_ENDPOINT,
  });
  const account = await connection.getAccountInfo(priceFeed(), "confirmed");
  if (!account) throw new Error(`${ORACLE_SYMBOL} oracle account not found`);
  return decodeOraclePrice(account.data);
}

export function subscribeOraclePrice(
  onPrice: (price: OraclePrice) => void,
  onError: (error: unknown) => void,
) {
  const connection = new Connection(ER_ENDPOINT, {
    commitment: "confirmed",
    wsEndpoint: ER_WS_ENDPOINT,
  });
  let subscriptionId: number | null = null;
  let disposed = false;

  fetchOraclePrice().then(onPrice).catch(onError);
  try {
    const id = connection.onAccountChange(
      priceFeed(),
      (account) => {
        try {
          onPrice(decodeOraclePrice(account.data));
        } catch (error) {
          onError(error);
        }
      },
      "confirmed",
    );
    if (disposed) {
      void connection.removeAccountChangeListener(id);
    } else {
      subscriptionId = id;
    }
  } catch (error) {
    onError(error);
  }

  return () => {
    disposed = true;
    if (subscriptionId !== null) {
      void connection.removeAccountChangeListener(subscriptionId);
    }
  };
}

async function maybeAirdrop(connection: Connection, publicKey: PublicKey) {
  const balance = await connection.getBalance(publicKey, "confirmed");
  if (balance > MIN_OPERATOR_SOL * anchor.web3.LAMPORTS_PER_SOL) return;
  try {
    const signature = await connection.requestAirdrop(
      publicKey,
      anchor.web3.LAMPORTS_PER_SOL,
    );
    await connection.confirmTransaction(signature, "confirmed");
  } catch (error) {
    throw new Error(
      [
        `Devnet faucet could not fund ${publicKey.toBase58()}.`,
        `Send at least ${MIN_OPERATOR_SOL} devnet SOL to this address and retry Initialize.`,
        error instanceof Error ? error.message : String(error),
      ].join(" "),
    );
  }
}

async function sendSignedTransaction(
  connection: Connection,
  transaction: Transaction,
  feePayer: Keypair,
  signers: Keypair[] = [],
  commitment: Commitment = "confirmed",
): Promise<TransactionResult> {
  const blockhash = await connection.getLatestBlockhash(commitment);
  const signerMap = new Map<string, Keypair>();
  [feePayer, ...signers].forEach((signer) =>
    signerMap.set(signer.publicKey.toBase58(), signer),
  );

  transaction.feePayer = feePayer.publicKey;
  transaction.recentBlockhash = blockhash.blockhash;
  transaction.partialSign(...signerMap.values());

  const sendStart = performance.now();
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    {
      preflightCommitment: commitment,
      skipPreflight: true,
    },
  );
  const sendMs = performance.now() - sendStart;

  const confirmStart = performance.now();
  const status = await connection.confirmTransaction(
    { signature, ...blockhash },
    commitment,
  );
  const confirmMs = performance.now() - confirmStart;
  if (status.value.err) {
    throw new Error(
      `Transaction ${signature} failed: ${JSON.stringify(status.value.err)}`,
    );
  }
  return {
    signature,
    sendMs,
    confirmMs,
    totalMs: sendMs + confirmMs,
    commitment,
  };
}

export async function bootstrapMarket(
  market: StoredMarket,
  options: {
    seedAmount: number;
    userAmount: number;
    durationSeconds: number;
    minStake: number;
    payoutBps: number;
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

  options.onLog({
    tone: "info",
    message: `Using live ${ORACLE_SYMBOL} oracle`,
  });
  await fetchOraclePrice();

  options.onLog({ tone: "info", message: "Seeding prediction pool" });
  const initializeTx = await (program as any).methods
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
    .transaction();
  await sendSignedTransaction(base.connection, initializeTx, admin, [
    poolAuthority,
  ]);

  options.onLog({ tone: "info", message: "Preparing user bet account" });
  const bet = betPda(program.programId, user.publicKey);
  const initializeBetTx = await (program as any).methods
    .initializeBet()
    .accountsPartial({
      payer: admin.publicKey,
      user: user.publicKey,
      bet,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  await sendSignedTransaction(base.connection, initializeBetTx, admin);

  const delegateBetTx = await (program as any).methods
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
    .transaction();
  await sendSignedTransaction(base.connection, delegateBetTx, admin, [user]);

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
  await sendSignedTransaction(
    base.connection,
    new Transaction().add(...delegateUserIxs),
    admin,
    [user],
  );

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
): Promise<TransactionResult> {
  if (!market.mint || !market.userAta || !market.poolAta) {
    throw new Error("Market setup is incomplete");
  }
  const { admin, user, poolAuthority } = keypairs(market);
  const { er, program } = providers(market);
  const pool = poolPda(program.programId);

  return sendSignedTransaction(
    er.connection,
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
    admin,
    [poolAuthority, user],
    "processed",
  );
}

export async function createSession(
  market: StoredMarket,
  options: {
    ttlSeconds: number;
    topUpLamports: number;
  },
): Promise<{ market: StoredMarket; result: TransactionResult }> {
  const { market: nextMarket, session } = withSessionKeypair(market);
  const { admin, user } = keypairs(nextMarket);
  const { base, program } = providers(nextMarket);
  const sessionManager = new SessionTokenManager(
    new KeypairWallet(admin),
    base.connection,
  );
  const validUntil = Math.floor(Date.now() / 1_000) + options.ttlSeconds;
  const sessionToken = sessionTokenPda(
    sessionManager.program.programId,
    program.programId,
    session.publicKey,
    user.publicKey,
  );

  const transaction = await (sessionManager.program as any).methods
    .createSessionV2(true, new BN(validUntil), new BN(options.topUpLamports))
    .accounts({
      targetProgram: program.programId,
      sessionSigner: session.publicKey,
      feePayer: admin.publicKey,
      authority: user.publicKey,
    })
    .signers([user, session])
    .transaction();
  const result = await sendSignedTransaction(
    base.connection,
    transaction,
    admin,
    [user, session],
  );

  const updatedMarket = {
    ...nextMarket,
    sessionToken: sessionToken.toBase58(),
    sessionValidUntil: validUntil,
  };
  saveMarket(updatedMarket);
  return { market: updatedMarket, result };
}

export async function approveSessionWallet(
  market: StoredMarket,
  allowance: number,
): Promise<{ market: StoredMarket; result: TransactionResult }> {
  if (!market.userAta) {
    throw new Error("Market setup is incomplete");
  }
  const { session, user } = keypairs(market);
  if (!session || !market.sessionToken) {
    throw new Error("Create a session before approving session allowance");
  }
  const { admin } = keypairs(market);
  const { er } = providers(market);
  const result = await sendSignedTransaction(
    er.connection,
    new Transaction().add(
      createApproveInstruction(
        new PublicKey(market.userAta),
        session.publicKey,
        user.publicKey,
        BigInt(allowance),
      ),
    ),
    admin,
    [user],
    "processed",
  );
  const updatedMarket = {
    ...market,
    sessionAllowance: allowance,
  };
  saveMarket(updatedMarket);
  return { market: updatedMarket, result };
}

export async function placeBet(
  market: StoredMarket,
  direction: Direction,
  stake: number,
): Promise<TransactionResult> {
  if (!market.userAta || !market.poolAta) {
    throw new Error("Market setup is incomplete");
  }
  const { admin, poolAuthority, user } = keypairs(market);
  const { er, erProgram } = providers(market);
  const pool = poolPda(erProgram.programId);
  const bet = betPda(erProgram.programId, user.publicKey);
  const poolTokenAccount = new PublicKey(market.poolAta);
  const userTokenAccount = new PublicKey(market.userAta);

  const transaction = await (erProgram as any).methods
    .placeBet(direction === "up" ? { up: {} } : { down: {} }, new BN(stake))
    .preInstructions([
      createApproveInstruction(
        poolTokenAccount,
        pool,
        poolAuthority.publicKey,
        BigInt(stake * 20),
      ),
      createApproveInstruction(
        userTokenAccount,
        pool,
        user.publicKey,
        BigInt(stake * 2),
      ),
    ])
    .accountsPartial({
      payer: user.publicKey,
      user: user.publicKey,
      pool,
      bet,
      userTokenAccount,
      poolTokenAccount,
      priceUpdate: priceFeed(),
      tokenProgram: TOKEN_PROGRAM_ID,
      sessionToken: null,
    })
    .signers([user])
    .transaction();
  return sendSignedTransaction(
    er.connection,
    transaction,
    admin,
    [poolAuthority, user],
    "processed",
  );
}

export async function placeBetWithTokenSigner(
  market: StoredMarket,
  direction: Direction,
  stake: number,
  useSession: boolean,
): Promise<TransactionResult> {
  if (!market.userAta || !market.poolAta) {
    throw new Error("Market setup is incomplete");
  }
  const { admin, session, user } = keypairs(market);
  const { er, erProgram } = providers(market);
  const pool = poolPda(erProgram.programId);
  const bet = betPda(erProgram.programId, user.publicKey);
  const payer = useSession ? session : user;
  if (!payer) throw new Error("Create a session before using session betting");

  const transaction = await (erProgram as any).methods
    .placeBet(direction === "up" ? { up: {} } : { down: {} }, new BN(stake))
    .accountsPartial({
      payer: payer.publicKey,
      user: user.publicKey,
      pool,
      bet,
      userTokenAccount: new PublicKey(market.userAta),
      poolTokenAccount: new PublicKey(market.poolAta),
      priceUpdate: priceFeed(),
      tokenProgram: TOKEN_PROGRAM_ID,
      sessionToken:
        useSession && market.sessionToken
          ? new PublicKey(market.sessionToken)
          : null,
    })
    .signers([payer])
    .transaction();
  return sendSignedTransaction(
    er.connection,
    transaction,
    admin,
    [payer],
    "processed",
  );
}

export async function settleBet(
  market: StoredMarket,
): Promise<TransactionResult> {
  if (!market.userAta || !market.poolAta) {
    throw new Error("Market setup is incomplete");
  }
  const { admin, user } = keypairs(market);
  const { er, erProgram } = providers(market);
  const pool = poolPda(erProgram.programId);
  const bet = betPda(erProgram.programId, user.publicKey);

  const transaction = await (erProgram as any).methods
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
    .transaction();
  return sendSignedTransaction(
    er.connection,
    transaction,
    admin,
    [],
    "processed",
  );
}

export async function refreshSnapshot(
  market: StoredMarket,
): Promise<MarketSnapshot> {
  const { admin, user, poolAuthority, session } = keypairs(market);
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
  const [adminSol, userSol, poolAuthoritySol] = await Promise.all(
    [admin.publicKey, user.publicKey, poolAuthority.publicKey].map(
      async (publicKey) => {
        try {
          const balance = await base.connection.getBalance(
            publicKey,
            "confirmed",
          );
          return (balance / anchor.web3.LAMPORTS_PER_SOL).toFixed(3);
        } catch {
          return "-";
        }
      },
    ),
  );

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
  let betDirection: Direction | undefined;
  let currentPrice = "-";
  let payoutBps = "-";
  try {
    currentPrice = (await fetchOraclePrice()).raw;
  } catch {
    currentPrice = "-";
  }

  try {
    const account = await (erProgram as any).account.pool.fetch(pool);
    payoutBps = account.payoutBps.toString();
  } catch {
    // Pool account has not been initialized or delegated yet.
  }

  try {
    const account = await (erProgram as any).account.bet.fetch(bet);
    openPrice = account.openPrice.toString();
    stake = account.stake.toString();
    expiry = account.expiryTs.toString();
    isOpen = Boolean(account.isOpen);
    betDirection = isOpen ? directionFromAccount(account.direction) : undefined;
  } catch {
    // Bet account has not been initialized or delegated yet.
  }

  return {
    admin: admin.publicKey.toBase58(),
    user: user.publicKey.toBase58(),
    poolAuthority: poolAuthority.publicKey.toBase58(),
    sessionSigner: session?.publicKey.toBase58() ?? "-",
    sessionToken: market.sessionToken ?? "-",
    sessionValidUntil: market.sessionValidUntil?.toString() ?? "-",
    sessionAllowance: market.sessionAllowance?.toString() ?? "-",
    adminSol,
    userSol,
    poolAuthoritySol,
    mint: market.mint,
    pool: pool.toBase58(),
    bet: bet.toBase58(),
    priceFeed: feed.toBase58(),
    userTokens,
    poolTokens,
    userErTokens: market.userAta ? shortKey(market.userAta) : "-",
    poolErTokens: market.poolAta ? shortKey(market.poolAta) : "-",
    openPrice,
    currentPrice,
    payoutBps,
    direction: betDirection,
    stake,
    expiry,
    isOpen,
  };
}
