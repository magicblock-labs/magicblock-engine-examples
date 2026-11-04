import { BN, Program } from "@coral-xyz/anchor";
import {
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
export const fetchJar = (jar: PublicKey) =>
  program.account.jar.fetch(jar).catch(() => {
    throw new Error(
      `No tip jar at ${jar.toBase58()}. Run \`yarn create-jar\` and set VITE_JAR_ADDRESS.`,
    );
  });

/**
 * Send one instruction to the ER. The wallet is the fee payer even though it
 * holds no SOL: ER transactions are free. No popup, no gas.
 */
export async function sendOnEr(
  wallet: Keypair,
  ix: TransactionInstruction,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await er.getLatestBlockhash();
  const tx = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(ix);
  tx.sign(wallet);
  const signature = await er.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
  });
  const { value } = await er.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  invariant(
    !value.err,
    `Rollup rejected the transaction: ${JSON.stringify(value.err)}`,
  );
  return signature;
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
