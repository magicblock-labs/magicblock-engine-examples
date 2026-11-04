import { Keypair, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  delegateSpl,
  withdrawSpl,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { RELAY_FEE, USDC_MINT, VALIDATOR } from "../src/lib/config";
import type { PaymentBuild, PaymentKind } from "../src/lib/payments";

export const sponsor = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();

/** What the hosted API returns: a sponsor-signed transaction for `owner`. */
export async function apiBuild(
  owner: Keypair,
  kind: PaymentKind,
  amount: bigint,
  { privateDeposit = false, signBySponsor = true } = {},
): Promise<PaymentBuild> {
  const options = {
    payer: sponsor.publicKey,
    validator: VALIDATOR,
    shuttleId: 4242,
    escrowIndex: 0,
    initIfMissing: true,
    initAtasIfMissing: true,
    idempotent: true,
  };
  const shuttle =
    kind === "deposit"
      ? await delegateSpl(owner.publicKey, USDC_MINT, amount, {
          ...options,
          private: privateDeposit,
          initVaultIfMissing: true,
        })
      : await withdrawSpl(owner.publicKey, USDC_MINT, amount, options);
  const tx = new Transaction({
    feePayer: sponsor.publicKey,
    recentBlockhash: blockhash,
  }).add(
    createTransferInstruction(
      getAssociatedTokenAddressSync(USDC_MINT, owner.publicKey),
      getAssociatedTokenAddressSync(USDC_MINT, sponsor.publicKey),
      owner.publicKey,
      RELAY_FEE,
    ),
    ...shuttle,
  );
  if (signBySponsor) tx.partialSign(sponsor);
  return {
    kind,
    version: "legacy",
    sendTo: "base",
    validator: VALIDATOR.toBase58(),
    transactionBase64: tx
      .serialize({ requireAllSignatures: false })
      .toString("base64"),
    recentBlockhash: blockhash,
    lastValidBlockHeight: 1_000,
    requiredSigners: [sponsor.publicKey.toBase58(), owner.publicKey.toBase58()],
    instructionCount: tx.instructions.length,
    fees: { tokens: String(RELAY_FEE), lamports: "0" },
  };
}
