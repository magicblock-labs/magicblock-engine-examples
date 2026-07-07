import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  AccountMeta,
  SystemProgram,
} from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID } from "@/lib/constants";

const TOP_UP_EPHEMERAL_BALANCE_DISCRIMINATOR = 9;
const EPHEMERAL_BALANCE_TAG = Buffer.from("balance");

/**
 * Default escrow index used when scheduling actions via
 * `ActionArgs::new(...)` without `with_escrow_index`. Matches the value in
 * `magicblock-magic-program-api/src/args.rs`.
 */
export const DEFAULT_ESCROW_INDEX = 255;

/**
 * Derive the DLP "ephemeral balance" PDA (called the "escrow" elsewhere in
 * this codebase) from an authority pubkey and an index.
 *
 *   seeds      = [b"balance", authority, [index]]
 *   program_id = DELEGATION_PROGRAM_ID
 */
export function deriveEphemeralBalancePda(
  authority: PublicKey,
  index: number = DEFAULT_ESCROW_INDEX,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [EPHEMERAL_BALANCE_TAG, authority.toBuffer(), Buffer.from([index])],
    DELEGATION_PROGRAM_ID,
  );
}

/**
 * Build the DLP `TopUpEphemeralBalance` instruction.
 *
 * Accounts (per dlp-api `top_up_ephemeral_balance`):
 *   0: payer                 [signer, writable]
 *   1: authority pubkey      [readonly]      (escrow_authority)
 *   2: ephemeral balance PDA [writable]
 *   3: system program        [readonly]
 *
 * Data layout (17 bytes total):
 *   [0..8]   discriminator   u64 LE   (DLP encodes its discriminator as u64,
 *                                      see dlp-api/src/discriminator.rs::to_vec)
 *   [8..16]  amount          u64 LE   (borsh TopUpEphemeralBalanceArgs.amount)
 *   [16]     index           u8       (borsh TopUpEphemeralBalanceArgs.index)
 */
export function buildTopUpEphemeralBalance(
  payer: PublicKey,
  authority: PublicKey,
  amountLamports: bigint,
  index: number = DEFAULT_ESCROW_INDEX,
): Transaction {
  const [ephemeralBalancePda] = deriveEphemeralBalancePda(authority, index);

  const data = Buffer.alloc(8 + 8 + 1);
  data.writeBigUInt64LE(BigInt(TOP_UP_EPHEMERAL_BALANCE_DISCRIMINATOR), 0);
  data.writeBigUInt64LE(amountLamports, 8);
  data.writeUInt8(index, 16);

  const keys: AccountMeta[] = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: ephemeralBalancePda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new Transaction().add(
    new TransactionInstruction({
      programId: DELEGATION_PROGRAM_ID,
      keys,
      data,
    }),
  );
}
