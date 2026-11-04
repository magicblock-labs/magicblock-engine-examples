import { PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  delegateSpl,
  withdrawSpl,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  MIN_PAYMENT,
  PAYMENTS_API,
  PAYMENTS_CLUSTER,
  RELAY_FEE,
  USDC_MINT,
  VALIDATOR,
  invariant,
} from "./config";

export type PaymentKind = "deposit" | "withdraw";

/** What `POST /v1/spl/{deposit,withdraw}` returns. */
export interface PaymentBuild {
  kind: PaymentKind;
  version: string;
  sendTo: string;
  validator: string;
  transactionBase64: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  requiredSigners: string[];
  instructionCount: number;
  fees?: { tokens: string; lamports: string };
}

// Instruction discriminators of the ESPL shuttle flows the API uses.
const SHUTTLE_INSTRUCTION: Record<PaymentKind, number> = {
  deposit: 24, // setupAndDelegateShuttleEphemeralAtaWithMerge
  withdraw: 26, // withdrawThroughDelegatedShuttleWithMerge
};

// The same options the API passes to the SDK, so we can rebuild its transaction.
const sharedOptions = {
  validator: VALIDATOR,
  initIfMissing: true,
  initAtasIfMissing: true,
  idempotent: true,
};

/** Ask the Payments API for a sponsored (gasless) deposit or withdrawal. */
export async function buildPayment(
  owner: PublicKey,
  kind: PaymentKind,
  amount: bigint,
): Promise<PaymentBuild> {
  invariant(
    amount >= MIN_PAYMENT,
    "Gasless payments must be at least 0.50 USDC.",
  );
  const response = await fetch(`${PAYMENTS_API}/v1/spl/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      owner: owner.toBase58(),
      cluster: PAYMENTS_CLUSTER,
      mint: USDC_MINT.toBase58(),
      amount: Number(amount),
      gasless: true,
      ...sharedOptions,
      validator: VALIDATOR.toBase58(),
      ...(kind === "deposit"
        ? { private: false, initVaultIfMissing: true }
        : { escrowIndex: 0 }),
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json();
  invariant(
    response.ok,
    body.error?.message ?? `Payments API returned ${response.status}.`,
  );
  return body as PaymentBuild;
}

/**
 * Never sign what a server sends without checking it. Rebuild the expected
 * transaction locally with the SDK and require the exact same message bytes:
 * the relay fee to the sponsor, then the shuttle instructions for this owner,
 * amount and validator. Returns the sponsor-signed transaction, ready for the
 * owner's signature.
 */
export async function validatePayment(
  build: PaymentBuild,
  owner: PublicKey,
  kind: PaymentKind,
  amount: bigint,
): Promise<Transaction> {
  invariant(
    build.kind === kind &&
      build.version === "legacy" &&
      build.sendTo === "base" &&
      build.validator === VALIDATOR.toBase58() &&
      build.fees?.tokens === String(RELAY_FEE),
    "Unexpected payment routing, validator or fee.",
  );
  const tx = Transaction.from(Buffer.from(build.transactionBase64, "base64"));

  // The sponsor pays the SOL fee and has already signed. The owner has not.
  const sponsor = tx.feePayer;
  invariant(sponsor && !sponsor.equals(owner), "The payment has no sponsor.");
  invariant(
    tx.signatures.length === 2 &&
      tx.signatures.some((s) => s.publicKey.equals(owner)) &&
      tx.signatures.find((s) => s.publicKey.equals(sponsor))?.signature &&
      tx.verifySignatures(false),
    "Missing or invalid sponsor signature.",
  );
  invariant(
    tx.recentBlockhash === build.recentBlockhash &&
      build.lastValidBlockHeight > 0,
    "Invalid payment lifetime.",
  );

  // The server picks a random shuttle id. Read it back so we can rebuild.
  const shuttle = tx.instructions.at(-1);
  invariant(
    shuttle?.data.length === 45 &&
      shuttle.data[0] === SHUTTLE_INSTRUCTION[kind],
    "Unsupported payment instruction.",
  );
  const options = {
    ...sharedOptions,
    payer: sponsor,
    shuttleId: shuttle.data.readUInt32LE(1),
    escrowIndex: 0,
  };
  const shuttleInstructions =
    kind === "deposit"
      ? await delegateSpl(owner, USDC_MINT, amount, {
          ...options,
          private: false,
          initVaultIfMissing: true,
        })
      : await withdrawSpl(owner, USDC_MINT, amount, options);
  const expected = new Transaction({
    feePayer: sponsor,
    recentBlockhash: build.recentBlockhash,
  }).add(
    createTransferInstruction(
      getAssociatedTokenAddressSync(USDC_MINT, owner),
      getAssociatedTokenAddressSync(USDC_MINT, sponsor),
      owner,
      RELAY_FEE,
    ),
    ...shuttleInstructions,
  );
  invariant(
    tx.serializeMessage().equals(expected.serializeMessage()),
    "The payment differs from what you asked for. Nothing was signed.",
  );
  return tx;
}
