import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { MagicActionsAdvanced } from "../target/types/magic_actions_advanced";
import {
  ConnectionMagicRouter,
  createTopUpEscrowInstruction,
  escrowPdaFromEscrowAuthority,
  DELEGATION_PROGRAM_ID,
  MAGIC_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  PERMISSION_PROGRAM_ID,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  commitStatePdaFromDelegatedAccount,
  commitRecordPdaFromDelegatedAccount,
  undelegateBufferPdaFromDelegatedAccount,
  feesVaultPda,
  validatorFeesVaultPdaFromValidator,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  Connection,
  Transaction,
  sendAndConfirmTransaction,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { expect } from "chai";

const COUNTER_SEED = "counter";
const LEADERBOARD_SEED = "leaderboard";
const GLOBAL_SIGNER_SEED = "global_signer";

describe("magic-actions-advanced", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace
    .MagicActionsAdvanced as Program<MagicActionsAdvanced>;

  const routerEndpoint =
    process.env.ROUTER_ENDPOINT || "http://localhost:7799";
  const routerWsEndpoint =
    process.env.ROUTER_WS_ENDPOINT || "ws://localhost:7800";

  const routerConnection = new ConnectionMagicRouter(routerEndpoint, {
    wsEndpoint: routerWsEndpoint,
  });

  const isLocal =
    routerEndpoint.includes("localhost") ||
    routerEndpoint.includes("127.0.0.1");

  const baseConnection = new Connection(
    process.env.PROVIDER_ENDPOINT || "http://localhost:8899",
    { wsEndpoint: process.env.WS_ENDPOINT || "ws://localhost:8900" }
  );

  const erConnection = new Connection(
    process.env.ROUTER_ENDPOINT || "http://localhost:7799",
    { wsEndpoint: process.env.ROUTER_WS_ENDPOINT || "ws://localhost:7800" }
  );

  const wallet = anchor.Wallet.local();

  async function sendToBase(
    tx: Transaction,
    signers: anchor.web3.Signer[]
  ): Promise<string> {
    if (isLocal) {
      const { blockhash, lastValidBlockHeight } =
        await baseConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      return sendAndConfirmTransaction(baseConnection, tx, signers, {
        skipPreflight: true,
      });
    }
    return sendAndConfirmTransaction(routerConnection, tx, signers, {
      skipPreflight: true,
    });
  }

  async function sendToER(
    tx: Transaction,
    signers: anchor.web3.Signer[]
  ): Promise<string> {
    if (isLocal) {
      const { blockhash, lastValidBlockHeight } =
        await erConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      return sendAndConfirmTransaction(erConnection, tx, signers, {
        skipPreflight: true,
      });
    }
    return sendAndConfirmTransaction(routerConnection, tx, signers, {
      skipPreflight: true,
    });
  }

  const [counterPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId
  );

  const [leaderboardPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(LEADERBOARD_SEED)],
    program.programId
  );

  const [globalSignerPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(GLOBAL_SIGNER_SEED)],
    program.programId
  );

  const escrowPda = escrowPdaFromEscrowAuthority(globalSignerPda);

  const delegationRecord =
    delegationRecordPdaFromDelegatedAccount(counterPda);
  const delegationMetadata =
    delegationMetadataPdaFromDelegatedAccount(counterPda);

  console.log("Router Endpoint:   ", routerEndpoint);
  console.log("Program ID:        ", program.programId.toBase58());
  console.log("Counter PDA:       ", counterPda.toBase58());
  console.log("Leaderboard PDA:   ", leaderboardPda.toBase58());
  console.log("Global Signer PDA: ", globalSignerPda.toBase58());
  console.log("Escrow PDA:        ", escrowPda.toBase58());

  async function readCounterOnBase(): Promise<number> {
    const acct = await program.account.counter.fetch(counterPda);
    return acct.count.toNumber();
  }

  async function readCounterOnER(): Promise<number> {
    const conn = isLocal
      ? erConnection
      : (routerConnection as unknown as Connection);
    const info = await conn.getAccountInfo(counterPda);
    if (!info) throw new Error("Counter account not found on ER");
    // Anchor layout: 8-byte discriminator + 8-byte u64 LE
    return Number(info.data.readBigUInt64LE(8));
  }

  it("Initialize counter and leaderboard (both start at 0)", async () => {
    const tx = (await program.methods
      .initialize()
      .accounts({
        user: wallet.publicKey,
      })
      .transaction()) as Transaction;

    const sig = await sendToBase(tx, [wallet.payer]);
    await printState(
      program, counterPda, leaderboardPda, escrowPda,
      baseConnection, isLocal ? erConnection : routerConnection, sig, "Initialize"
    );

    const count = await readCounterOnBase();
    expect(count).to.equal(0, "Counter should start at 0");
    const lb = await program.account.leaderboard.fetch(leaderboardPda);
    expect(lb.highScore.toNumber()).to.equal(0, "High score should start at 0");
  });

  it("Delegate with queued increment — post-delegation action fires automatically on ER", async () => {
    const validatorIdentity = isLocal
      ? "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"
      : (await routerConnection.getClosestValidator()).identity;

    const remainingAccounts = [
      {
        pubkey: new anchor.web3.PublicKey(validatorIdentity),
        isSigner: false,
        isWritable: false,
      },
    ];

    // Fund the global_signer escrow so the protocol can pay for the magic action later
    const topUpIx = createTopUpEscrowInstruction(
      escrowPda,
      globalSignerPda,
      wallet.publicKey,
      10_000
    );

    const delegateIx = await program.methods
      .delegate()
      .accounts({
        payer: wallet.publicKey,
        delegationRecord,
        delegationMetadata,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();

    const tx = new Transaction().add(topUpIx, delegateIx);
    const sig = await sendToBase(tx, [wallet.payer]);
    console.log(`  Delegate tx: ${sig}`);

    // Give the validator time to clone the account and fire the post-delegation action
    await sleep(10);

    const count = await readCounterOnER();
    console.log(`  Counter on ER after delegation (no explicit increment): ${count}`);
    expect(count).to.equal(
      1,
      "Post-delegation increment should have raised count to 1 automatically"
    );
    await printState(
      program, counterPda, leaderboardPda, escrowPda,
      baseConnection, isLocal ? erConnection : routerConnection, sig,
      "Delegate + top-up escrow"
    );
  });

  it("Increment counter on ER", async () => {
    const tx = (await program.methods
      .increment()
      .accounts({ user: wallet.publicKey })
      .transaction()) as Transaction;

    const sig = await sendToER(tx, [wallet.payer]);
    await printState(
      program, counterPda, leaderboardPda, escrowPda,
      baseConnection, isLocal ? erConnection : routerConnection, sig, "Increment (ER)"
    );

    const count = await readCounterOnER();
    expect(count).to.equal(2, "Counter should be 2 after explicit increment");
  });

  it("Commit and update leaderboard via PDA-paid magic action", async () => {
    const validatorPubkey = new web3.PublicKey(
      "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"
    );
    const knownAddresses = buildKnownAddresses(
      wallet.publicKey,
      counterPda,
      leaderboardPda,
      globalSignerPda,
      escrowPda,
      program.programId,
      validatorPubkey
    );

    const tx = (await program.methods
      .commitAndUpdateLeaderboard()
      .accounts({
        payer: wallet.publicKey,
        programId: program.programId,
      })
      .transaction()) as Transaction;

    const sig = await sendToER(tx, [wallet.payer]);
    await sleep(10);
    await printState(
      program, counterPda, leaderboardPda, escrowPda,
      baseConnection, isLocal ? erConnection : routerConnection, sig,
      "Commit + update leaderboard (magic action)"
    );
    await printTransactionAccounts(
      "ER", sig, isLocal ? erConnection : routerConnection, knownAddresses
    );

    const DB_PATH =
      process.env.MAGICBLOCK_ER_DB_PATH ||
      "/tmp/magicblock-er-storage/committor_service.sqlite";
    const commitSigs = readCommitSigsFromDb(DB_PATH);
    console.log(`\n  Found ${commitSigs.length} L1 commit transaction(s) in ER database:`);
    for (const { commitSig, finalizeSig, status, pubkey } of commitSigs) {
      console.log(`  pubkey=${pubkey}  status=${status}`);
      if (commitSig) {
        console.log(`  commit-stage sig: ${commitSig}`);
        await printTransactionAccounts("L1 commit-stage", commitSig, baseConnection, knownAddresses);
      }
      if (finalizeSig) {
        console.log(`  finalize-stage sig: ${finalizeSig}`);
        await printTransactionAccounts("L1 finalize-stage", finalizeSig, baseConnection, knownAddresses);
      }
    }

    const lb = await program.account.leaderboard.fetch(leaderboardPda);
    expect(lb.highScore.toNumber()).to.be.greaterThan(
      0,
      "Leaderboard high score should be updated after commit"
    );
  });

  it("Undelegate — counter final value lands on base", async () => {
    const tx = (await program.methods
      .undelegate()
      .accounts({
        payer: wallet.publicKey,
      })
      .transaction()) as Transaction;

    const sig = await sendToER(tx, [wallet.payer]);
    console.log(`  Undelegate tx: ${sig}`);

    await sleep(8);
    await printState(
      program, counterPda, leaderboardPda, escrowPda,
      baseConnection, isLocal ? erConnection : routerConnection, sig, "Undelegate"
    );

    const count = await readCounterOnBase();
    console.log(`  Counter on base after undelegate: ${count}`);
    expect(count).to.be.greaterThanOrEqual(
      1,
      "Count should reflect at least the post-delegation increment after undelegation"
    );
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function printState(
  program: Program<MagicActionsAdvanced>,
  counterPda: web3.PublicKey,
  leaderboardPda: web3.PublicKey,
  escrowPda: web3.PublicKey,
  baseConn: Connection,
  erConn: Connection | ConnectionMagicRouter,
  signature: string,
  label: string
) {
  let isDelegated = false;
  try {
    if (erConn instanceof ConnectionMagicRouter) {
      const status = await erConn.getDelegationStatus(counterPda);
      isDelegated = status?.isDelegated ?? false;
    } else {
      const info = await erConn.getAccountInfo(counterPda);
      isDelegated =
        info !== null &&
        info.owner.toBase58() !== program.programId.toBase58();
    }
  } catch {}

  let counterBase = "—";
  let counterER = "—";
  if (isDelegated) {
    counterBase = "<delegated>";
    const erInfo = await erConn.getAccountInfo(counterPda);
    counterER = erInfo ? erInfo.data.readBigUInt64LE(8).toString() : "?";
  } else {
    counterER = "<not delegated>";
    try {
      const acct = await program.account.counter.fetch(counterPda);
      counterBase = acct.count.toNumber().toString();
    } catch {
      counterBase = "?";
    }
  }

  let highScore = "—";
  try {
    const lb = await program.account.leaderboard.fetch(leaderboardPda);
    highScore = lb.highScore.toNumber().toString();
  } catch {
    highScore = "?";
  }

  let escrowLamports = "—";
  try {
    const escrowInfo = await baseConn.getAccountInfo(escrowPda);
    escrowLamports = escrowInfo
      ? `${escrowInfo.lamports} lamports`
      : "not found";
  } catch {
    escrowLamports = "?";
  }

  const LINE = "─".repeat(50);
  console.log(`\n┌${LINE}┐`);
  console.log(`│ ✅ ${label.padEnd(45)} │`);
  console.log(`│ sig: ${signature.slice(0, 43)}… │`);
  console.log(`├${LINE}┤`);
  console.log(`│ Counter (base):       ${counterBase.padEnd(26)} │`);
  console.log(`│ Counter (ER):         ${counterER.padEnd(26)} │`);
  console.log(`│ Delegation:           ${(isDelegated ? "delegated" : "not delegated").padEnd(26)} │`);
  console.log(`├${LINE}┤`);
  console.log(`│ Leaderboard high score: ${highScore.padEnd(24)} │`);
  console.log(`├${LINE}┤`);
  console.log(`│ Escrow balance:       ${escrowLamports.padEnd(26)} │`);
  console.log(`└${LINE}┘`);
}

function buildKnownAddresses(
  wallet: web3.PublicKey,
  counterPda: web3.PublicKey,
  leaderboardPda: web3.PublicKey,
  globalSignerPda: web3.PublicKey,
  escrowPda: web3.PublicKey,
  programId: web3.PublicKey,
  validatorPubkey: web3.PublicKey
): Map<string, string> {
  const m = new Map<string, string>();
  m.set(wallet.toBase58(), "Wallet (payer/signer)");
  m.set(programId.toBase58(), "magic-actions-advanced program");
  m.set(web3.SystemProgram.programId.toBase58(), "System Program");
  m.set(DELEGATION_PROGRAM_ID.toBase58(), "Delegation Program");
  m.set(MAGIC_PROGRAM_ID.toBase58(), "Magic Program (CPI target)");
  m.set(MAGIC_CONTEXT_ID.toBase58(), "Magic Context");
  m.set(PERMISSION_PROGRAM_ID.toBase58(), "Permission Program");
  m.set(validatorPubkey.toBase58(), "Validator Identity");
  m.set(counterPda.toBase58(), "Counter PDA");
  m.set(leaderboardPda.toBase58(), "Leaderboard PDA");
  m.set(globalSignerPda.toBase58(), "Global Signer PDA (escrow authority)");
  m.set(escrowPda.toBase58(), "Escrow PDA (magic-action balance)");
  m.set(
    delegationRecordPdaFromDelegatedAccount(counterPda).toBase58(),
    "Delegation Record PDA"
  );
  m.set(
    delegationMetadataPdaFromDelegatedAccount(counterPda).toBase58(),
    "Delegation Metadata PDA"
  );
  m.set(
    delegateBufferPdaFromDelegatedAccountAndOwnerProgram(counterPda, programId).toBase58(),
    "Delegate Buffer PDA"
  );
  m.set(
    commitStatePdaFromDelegatedAccount(counterPda).toBase58(),
    "Commit State PDA"
  );
  m.set(
    commitRecordPdaFromDelegatedAccount(counterPda).toBase58(),
    "Commit Record PDA"
  );
  m.set(
    undelegateBufferPdaFromDelegatedAccount(counterPda).toBase58(),
    "Undelegate Buffer PDA"
  );
  m.set(feesVaultPda().toBase58(), "Fees Vault PDA");
  m.set(
    validatorFeesVaultPdaFromValidator(validatorPubkey).toBase58(),
    "Validator Fees Vault PDA"
  );
  return m;
}

async function printTransactionAccounts(
  chain: string,
  signature: string,
  conn: Connection | ConnectionMagicRouter,
  knownAddresses: Map<string, string>
): Promise<void> {
  let parsed: ParsedTransactionWithMeta | null = null;
  try {
    parsed = await (conn as Connection).getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch {}

  if (!parsed) {
    console.log(`\n[${chain}] Could not fetch transaction: ${signature}`);
    return;
  }

  const accounts = parsed.transaction.message.accountKeys;
  const ADDR_W = 44;
  const LABEL_W = 38;
  const LINE = "─".repeat(ADDR_W + LABEL_W + 13);
  const title = `[${chain}] Transaction accounts — ${signature.slice(0, 20)}…`;

  console.log(`\n┌${LINE}┐`);
  console.log(`│ ${title}`.padEnd(LINE.length + 1) + "│");
  console.log(
    `├${"─".repeat(ADDR_W + 2)}┬${"─".repeat(6)}┬${"─".repeat(7)}┬${"─".repeat(LABEL_W + 2)}┤`
  );
  console.log(
    `│ ${"Address".padEnd(ADDR_W)} │ ${"Write".padEnd(4)} │ ${"Signer".padEnd(5)} │ ${"Label".padEnd(LABEL_W)} │`
  );
  console.log(
    `├${"─".repeat(ADDR_W + 2)}┼${"─".repeat(6)}┼${"─".repeat(7)}┼${"─".repeat(LABEL_W + 2)}┤`
  );

  for (const acct of accounts) {
    const addr = acct.pubkey.toBase58();
    const label = knownAddresses.get(addr) ?? "unknown";
    const writable = (acct as any).writable ? "yes" : "no";
    const signer = (acct as any).signer ? "yes" : "no";
    console.log(
      `│ ${addr.padEnd(ADDR_W)} │ ${writable.padEnd(4)} │ ${signer.padEnd(5)} │ ${label.padEnd(LABEL_W)} │`
    );
  }
  console.log(
    `└${"─".repeat(ADDR_W + 2)}┴${"─".repeat(6)}┴${"─".repeat(7)}┴${"─".repeat(LABEL_W + 2)}┘`
  );

  const ixs = parsed.transaction.message.instructions;
  const innerIxs = parsed.meta?.innerInstructions ?? [];
  console.log(`\n  Instructions (${ixs.length} top-level):`);
  for (let i = 0; i < ixs.length; i++) {
    const ix = ixs[i] as any;
    const progLabel =
      knownAddresses.get(ix.programId?.toBase58?.() ?? "") ??
      ix.programId?.toBase58?.() ??
      "?";
    console.log(
      `    [${i}] program: ${progLabel} | accounts: ${ix.accounts?.length ?? "?"}`
    );
    const inner = innerIxs.find((ii) => ii.index === i);
    if (inner) {
      for (let j = 0; j < inner.instructions.length; j++) {
        const cpi = inner.instructions[j] as any;
        const cpiLabel =
          knownAddresses.get(cpi.programId?.toBase58?.() ?? "") ??
          cpi.programId?.toBase58?.() ??
          "?";
        console.log(
          `      └─ CPI [${j}] program: ${cpiLabel} | accounts: ${cpi.accounts?.length ?? "?"}`
        );
      }
    }
  }
}

interface CommitRow {
  pubkey: string;
  status: string;
  commitSig: string | null;
  finalizeSig: string | null;
}

function readCommitSigsFromDb(dbPath: string): CommitRow[] {
  if (!existsSync(dbPath)) {
    console.warn(`  [warn] ER commit DB not found at ${dbPath} — set MAGICBLOCK_ER_DB_PATH to override`);
    return [];
  }
  try {
    const query = `SELECT pubkey, commit_status, commit_stage_signature, finalize_stage_signature FROM commit_status ORDER BY created_at ASC;`;
    const raw = execSync(`sqlite3 "${dbPath}" "${query}"`, {
      encoding: "utf8",
    }).trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => {
      const [pubkey, status, commitSig, finalizeSig] = line.split("|");
      return {
        pubkey: pubkey ?? "",
        status: status ?? "",
        commitSig: commitSig || null,
        finalizeSig: finalizeSig || null,
      };
    });
  } catch (err) {
    console.warn(`  [warn] Could not read ER commit DB: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}
