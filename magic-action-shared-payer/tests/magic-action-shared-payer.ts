import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { execSync } from "child_process";
import { MagicActionSharedPayer } from "../target/types/magic_action_shared_payer";
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
import { Connection, Transaction, sendAndConfirmTransaction, ParsedTransactionWithMeta } from "@solana/web3.js";

const COUNTER_SEED = "counter";
const SEED_LEADERBOARD = "leaderboard";
const GLOBAL_SIGNER_SEED = "global_signer";

describe("magic-action-shared-payer", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.MagicActionSharedPayer as Program<MagicActionSharedPayer>;

  const routerConnection: ConnectionMagicRouter = new ConnectionMagicRouter(
    process.env.ROUTER_ENDPOINT || "https://devnet-router.magicblock.app",
    {
      wsEndpoint: process.env.ROUTER_WS_ENDPOINT || "wss://devnet-router.magicblock.app",
    }
  );

  const isLocal =
    routerConnection.rpcEndpoint.includes("localhost") ||
    routerConnection.rpcEndpoint.includes("127.0.0.1");

  const baseConnection = new Connection(
    process.env.PROVIDER_ENDPOINT || "http://localhost:8899",
    { wsEndpoint: process.env.WS_ENDPOINT || "ws://localhost:8900" }
  );

  const erConnection = new Connection(
    process.env.ROUTER_ENDPOINT || "http://localhost:7799",
    { wsEndpoint: process.env.ROUTER_WS_ENDPOINT || "ws://localhost:7800" }
  );

  async function sendToBase(tx: Transaction, signers: anchor.web3.Signer[]): Promise<string> {
    if (isLocal) {
      const { blockhash, lastValidBlockHeight } = await baseConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      return sendAndConfirmTransaction(baseConnection, tx, signers, { skipPreflight: true });
    }
    return sendAndConfirmTransaction(routerConnection, tx, signers, { skipPreflight: true });
  }

  async function sendToER(tx: Transaction, signers: anchor.web3.Signer[]): Promise<string> {
    if (isLocal) {
      const { blockhash, lastValidBlockHeight } = await erConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      return sendAndConfirmTransaction(erConnection, tx, signers, { skipPreflight: true });
    }
    return sendAndConfirmTransaction(routerConnection, tx, signers, { skipPreflight: true });
  }

  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId
  );

  const [leaderboard_pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_LEADERBOARD)],
    program.programId
  );

  // global_signer is the escrow authority — a program-owned PDA with no data
  const [globalSignerPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(GLOBAL_SIGNER_SEED)],
    program.programId
  );

  // Escrow PDA derived from global_signer, not the wallet
  const escrowPda = escrowPdaFromEscrowAuthority(globalSignerPda);

  console.log("Router Endpoint:  ", routerConnection.rpcEndpoint);
  console.log("Program ID:       ", program.programId.toBase58());
  console.log("Counter PDA:      ", pda.toBase58());
  console.log("Leaderboard PDA:  ", leaderboard_pda.toBase58());
  console.log("Global Signer PDA:", globalSignerPda.toBase58());
  console.log("Escrow PDA:       ", escrowPda.toBase58());

  it("Initialize Counter!", async () => {
    const tx = await program.methods
      .initialize()
      .accounts({
        counter: pda,
        leaderboard: leaderboard_pda,
        user: anchor.Wallet.local().publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction() as Transaction;
    const signature = await sendToBase(tx, [anchor.Wallet.local().payer]);
    await printState(program, pda, leaderboard_pda, escrowPda, baseConnection, isLocal ? erConnection : routerConnection, signature, "Initialize Counter");
  });

  it("Increment Counter!", async () => {
    const tx = await program.methods
      .increment()
      .accounts({ counter: pda })
      .transaction() as Transaction;
    const signature = await sendToBase(tx, [anchor.Wallet.local().payer]);
    await printState(program, pda, leaderboard_pda, escrowPda, baseConnection, isLocal ? erConnection : routerConnection, signature, "Increment Counter (base)");
  });

  it("Update Leaderboard!", async () => {
    const tx = await program.methods
      .updateLeaderboard()
      .accounts({
        counter: pda,
        escrowAuth: globalSignerPda,
        escrow: escrowPda,
      })
      .transaction() as Transaction;
    const signature = await sendToBase(tx, [anchor.Wallet.local().payer]);
    await printState(program, pda, leaderboard_pda, escrowPda, baseConnection, isLocal ? erConnection : routerConnection, signature, "Update Leaderboard");
  });

  it("Delegate Counter to ER and create Escrow for Magic Action!", async () => {
    const validatorIdentity = isLocal
      ? "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"
      : (await routerConnection.getClosestValidator()).identity;

    const remainingAccounts = [
      { pubkey: new web3.PublicKey(validatorIdentity), isSigner: false, isWritable: false },
    ];

    // Fund the escrow that belongs to global_signer; wallet is the payer (funder)
    const topUpEscrowIx = createTopUpEscrowInstruction(
      escrowPda,
      globalSignerPda,
      anchor.Wallet.local().publicKey,
      10000
    );

    const delegateIx = await program.methods
      .delegate()
      .accounts({ payer: anchor.Wallet.local().publicKey, pda })
      .remainingAccounts(remainingAccounts)
      .instruction();

    const tx = new Transaction().add(topUpEscrowIx, delegateIx);
    const signature = await sendToBase(tx, [anchor.Wallet.local().payer]);

    await sleepWithAnimation(10);
    await printState(program, pda, leaderboard_pda, escrowPda, baseConnection, isLocal ? erConnection : routerConnection, signature, "Delegate to ER + Top-up Escrow");
  });

  it("Increment Counter on ER!", async () => {
    const tx = await program.methods
      .increment()
      .accounts({ counter: pda })
      .transaction() as Transaction;
    const signature = await sendToER(tx, [anchor.Wallet.local().payer]);
    await printState(program, pda, leaderboard_pda, escrowPda, baseConnection, isLocal ? erConnection : routerConnection, signature, "Increment Counter (ER)");
  });

  it("Update Leaderboard While Delegated!", async () => {
    const validatorPubkey = new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev");
    const knownAddresses = buildKnownAddresses(
      anchor.Wallet.local().publicKey,
      pda,
      leaderboard_pda,
      globalSignerPda,
      escrowPda,
      program.programId,
      validatorPubkey,
    );

    const tx = await program.methods
      .commitAndUpdateLeaderboard()
      .accounts({
        payer: anchor.Wallet.local().publicKey,
        globalSigner: globalSignerPda,
        programId: program.programId,
      })
      .transaction() as Transaction;

    const signature = await sendToER(tx, [anchor.Wallet.local().payer]);
    await sleepWithAnimation(10);
    await printState(program, pda, leaderboard_pda, escrowPda, baseConnection, isLocal ? erConnection : routerConnection, signature, "Commit + Update Leaderboard (Magic Action)");

    await printTransactionAccounts("ER", signature, isLocal ? erConnection : routerConnection, knownAddresses);

    const DB_PATH = "/tmp/magicblock-er-storage/committor_service.sqlite";
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
  });

  it("Undelegate Counter!", async () => {
    const tx = await program.methods
      .undelegate()
      .accounts({ payer: anchor.Wallet.local().publicKey })
      .transaction() as Transaction;
    const signature = await sendToER(tx, [anchor.Wallet.local().payer]);
    await sleepWithAnimation(5);
    await printState(program, pda, leaderboard_pda, escrowPda, baseConnection, isLocal ? erConnection : routerConnection, signature, "Undelegate Counter");
  });

});

async function printState(
  program: Program<MagicActionSharedPayer>,
  counterPda: web3.PublicKey,
  leaderboardPda: web3.PublicKey,
  escrowPda: web3.PublicKey,
  baseConn: Connection,
  erConn: Connection | ConnectionMagicRouter,
  signature: string,
  label: string,
) {
  let isDelegated = false;
  try {
    if (erConn instanceof ConnectionMagicRouter) {
      const status = await erConn.getDelegationStatus(counterPda);
      isDelegated = status?.isDelegated ?? false;
    } else {
      const info = await erConn.getAccountInfo(counterPda);
      isDelegated = info !== null && info.owner.toBase58() !== program.programId.toBase58();
    }
  } catch { }

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
    } catch { counterBase = "?"; }
  }

  let highScore = "—";
  try {
    const lb = await program.account.leaderboard.fetch(leaderboardPda);
    highScore = lb.highScore.toNumber().toString();
  } catch { highScore = "?"; }

  let escrowLamports = "—";
  try {
    const escrowInfo = await baseConn.getAccountInfo(escrowPda);
    escrowLamports = escrowInfo ? `${escrowInfo.lamports} lamports` : "not found";
  } catch { escrowLamports = "?"; }

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

async function sleepWithAnimation(seconds: number): Promise<void> {
  const totalMs = seconds * 1000;
  const interval = 500;
  const iterations = Math.floor(totalMs / interval);
  for (let i = 0; i < iterations; i++) {
    const dots = ".".repeat((i % 3) + 1);
    process.stdout.write(`\rWaiting${dots}   `);
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  process.stdout.write("\r\x1b[K");
}

function buildKnownAddresses(
  wallet: web3.PublicKey,
  counterPda: web3.PublicKey,
  leaderboardPda: web3.PublicKey,
  globalSignerPda: web3.PublicKey,
  escrowPda: web3.PublicKey,
  programId: web3.PublicKey,
  validatorPubkey: web3.PublicKey,
): Map<string, string> {
  const m = new Map<string, string>();
  m.set(wallet.toBase58(), "Wallet (payer/signer)");
  m.set(programId.toBase58(), "magic-action-shared-payer program");
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
  m.set(delegationRecordPdaFromDelegatedAccount(counterPda).toBase58(), "Delegation Record PDA");
  m.set(delegationMetadataPdaFromDelegatedAccount(counterPda).toBase58(), "Delegation Metadata PDA");
  m.set(delegateBufferPdaFromDelegatedAccountAndOwnerProgram(counterPda, programId).toBase58(), "Delegate Buffer PDA");
  m.set(commitStatePdaFromDelegatedAccount(counterPda).toBase58(), "Commit State PDA");
  m.set(commitRecordPdaFromDelegatedAccount(counterPda).toBase58(), "Commit Record PDA");
  m.set(undelegateBufferPdaFromDelegatedAccount(counterPda).toBase58(), "Undelegate Buffer PDA");
  m.set(feesVaultPda().toBase58(), "Fees Vault PDA");
  m.set(validatorFeesVaultPdaFromValidator(validatorPubkey).toBase58(), "Validator Fees Vault PDA");
  return m;
}

async function printTransactionAccounts(
  chain: string,
  signature: string,
  conn: Connection | ConnectionMagicRouter,
  knownAddresses: Map<string, string>,
): Promise<void> {
  let parsed: ParsedTransactionWithMeta | null = null;
  try {
    parsed = await (conn as Connection).getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch { }

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
  console.log(`├${"─".repeat(ADDR_W + 2)}┬${"─".repeat(6)}┬${"─".repeat(7)}┬${"─".repeat(LABEL_W + 2)}┤`);
  console.log(`│ ${"Address".padEnd(ADDR_W)} │ ${"Write".padEnd(4)} │ ${"Signer".padEnd(5)} │ ${"Label".padEnd(LABEL_W)} │`);
  console.log(`├${"─".repeat(ADDR_W + 2)}┼${"─".repeat(6)}┼${"─".repeat(7)}┼${"─".repeat(LABEL_W + 2)}┤`);

  for (const acct of accounts) {
    const addr = acct.pubkey.toBase58();
    const label = knownAddresses.get(addr) ?? "unknown";
    const writable = (acct as any).writable ? "yes" : "no";
    const signer = (acct as any).signer ? "yes" : "no";
    console.log(`│ ${addr.padEnd(ADDR_W)} │ ${writable.padEnd(4)} │ ${signer.padEnd(5)} │ ${label.padEnd(LABEL_W)} │`);
  }

  console.log(`└${"─".repeat(ADDR_W + 2)}┴${"─".repeat(6)}┴${"─".repeat(7)}┴${"─".repeat(LABEL_W + 2)}┘`);

  const ixs = parsed.transaction.message.instructions;
  const innerIxs = parsed.meta?.innerInstructions ?? [];
  console.log(`\n  Instructions (${ixs.length} top-level):`);
  for (let i = 0; i < ixs.length; i++) {
    const ix = ixs[i] as any;
    const progLabel = knownAddresses.get(ix.programId?.toBase58?.() ?? "") ?? ix.programId?.toBase58?.() ?? "?";
    console.log(`    [${i}] program: ${progLabel} | accounts: ${ix.accounts?.length ?? "?"}`);
    const inner = innerIxs.find(ii => ii.index === i);
    if (inner) {
      for (let j = 0; j < inner.instructions.length; j++) {
        const cpi = inner.instructions[j] as any;
        const cpiLabel = knownAddresses.get(cpi.programId?.toBase58?.() ?? "") ?? cpi.programId?.toBase58?.() ?? "?";
        console.log(`      └─ CPI [${j}] program: ${cpiLabel} | accounts: ${cpi.accounts?.length ?? "?"}`);
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
  try {
    const query = `SELECT pubkey, commit_status, commit_stage_signature, finalize_stage_signature FROM commit_status ORDER BY created_at ASC;`;
    const raw = execSync(`sqlite3 "${dbPath}" "${query}"`, { encoding: "utf8" }).trim();
    if (!raw) return [];
    return raw.split("\n").map(line => {
      const [pubkey, status, commitSig, finalizeSig] = line.split("|");
      return { pubkey: pubkey ?? "", status: status ?? "", commitSig: commitSig || null, finalizeSig: finalizeSig || null };
    });
  } catch {
    return [];
  }
}
