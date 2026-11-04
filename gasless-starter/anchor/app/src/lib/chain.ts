import { BN, Program } from "@coral-xyz/anchor";
import {
  type BlockhashWithExpiryBlockHeight,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import {
  DELEGATION_PROGRAM_ID,
  delegationRecordPdaFromDelegatedAccount,
  deriveEphemeralAta,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { BASE_RPC, ER_RPC, USDC_MINT, VALIDATOR, invariant } from "./config";
import type { Balances } from "./sponsored";
import idl from "../idl/tip_jar.json";
import type { TipJar } from "../idl/tip_jar";

export const base = new Connection(BASE_RPC, "confirmed");
export const er = new Connection(ER_RPC, "confirmed");
export const program = new Program<TipJar>(idl as TipJar, { connection: er });

const usdcAccount = (owner: PublicKey) =>
  getAssociatedTokenAddressSync(USDC_MINT, owner, true);

async function tokenAmount(connection: Connection, owner: PublicKey) {
  const account = await connection.getAccountInfo(usdcAccount(owner));
  return account ? unpackAccount(usdcAccount(owner), account).amount : 0n;
}

/**
 * Base USDC is the wallet's token account on Solana. ER USDC only exists once the
 * wallet's ephemeral ATA is delegated (the first gasless deposit does that); the
 * ER then holds the live copy of the same token account.
 */
export async function readBalances(owner: PublicKey): Promise<Balances> {
  const [eata] = deriveEphemeralAta(owner, USDC_MINT);
  const [baseAmount, eataInfo] = await Promise.all([
    tokenAmount(base, owner),
    base.getAccountInfo(eata),
  ]);
  if (!eataInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
    return { base: baseAmount, er: 0n };
  }
  // The delegation record stores the validator at bytes 8..40.
  const record = await base.getAccountInfo(
    delegationRecordPdaFromDelegatedAccount(eata),
  );
  invariant(
    record && new PublicKey(record.data.subarray(8, 40)).equals(VALIDATOR),
    "This wallet's USDC is delegated to a different validator.",
  );
  return { base: baseAmount, er: await tokenAmount(er, owner) };
}

export const jarTokenBalance = (jar: PublicKey) => tokenAmount(er, jar);

/** The jar as the ER sees it (live), not the last commit on Solana. */
export async function fetchJar(jar: PublicKey) {
  const account = await program.account.jar.fetchNullable(jar);
  invariant(
    account,
    `No tip jar at ${jar.toBase58()}. Run \`yarn create-jar\` and set VITE_JAR_ADDRESS.`,
  );
  return account;
}

// ER blockhashes stay valid for about a minute, so fetch the next one ahead of
// time and sending costs no extra round trip. Each one is used only once: two
// identical tips with the same blockhash would be the same transaction.
const fetchBlockhash = () =>
  er.getLatestBlockhash().then(
    (value) => ({ value, at: Date.now() }),
    () => undefined, // retried by takeBlockhash
  );
let nextBlockhash = fetchBlockhash();

async function takeBlockhash(): Promise<BlockhashWithExpiryBlockHeight> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cached = nextBlockhash;
    nextBlockhash = fetchBlockhash();
    const hit = await cached;
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
  }
  throw new Error("Could not reach the rollup.");
}

/**
 * Send one instruction to the ER. The wallet is the fee payer even though it
 * holds no SOL: ER transactions are free. No popup, no gas.
 *
 * The ER executes a transaction as soon as it arrives, so polling its status
 * right after sending is faster than `confirmTransaction`, which opens a
 * websocket for every call.
 */
export async function sendOnEr(
  wallet: Keypair,
  ix: TransactionInstruction,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await takeBlockhash();
  const tx = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(ix);
  tx.sign(wallet);
  const signature = await er.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
  });
  for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
    const {
      value: [status],
    } = await er.getSignatureStatuses([signature]);
    if (status?.confirmationStatus) {
      invariant(
        !status.err,
        `Rollup rejected the transaction: ${JSON.stringify(status.err)}`,
      );
      return signature;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Rollup did not confirm ${signature} in 30 seconds.`);
}

export const tipInstruction = (
  tipper: PublicKey,
  jar: PublicKey,
  amount: bigint,
) =>
  program.methods
    .tip(new BN(amount.toString()))
    .accountsPartial({
      tipper,
      tipperToken: usdcAccount(tipper),
      jar,
      jarToken: usdcAccount(jar),
    })
    .instruction();

export const withdrawTipsInstruction = (
  authority: PublicKey,
  jar: PublicKey,
  amount: bigint,
) =>
  program.methods
    .withdrawTips(new BN(amount.toString()))
    .accountsPartial({
      authority,
      jar,
      jarToken: usdcAccount(jar),
      destination: usdcAccount(authority),
    })
    .instruction();

export const commitJarInstruction = (authority: PublicKey, jar: PublicKey) =>
  program.methods.commitJar().accountsPartial({ authority, jar }).instruction();

export const explorerUrl = (signature: string, onEr: boolean) =>
  onEr
    ? `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(ER_RPC)}`
    : `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
