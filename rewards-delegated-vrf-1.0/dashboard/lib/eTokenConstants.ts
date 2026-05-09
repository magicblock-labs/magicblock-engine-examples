import { PublicKey } from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";

// E-token (Ephemeral SPL) program — fixed on-chain address
export const E_TOKEN_PROGRAM_ID = new PublicKey(
  "SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2"
);

export const E_TOKEN_DELEGATION_PROGRAM_ID = new PublicKey(
  DELEGATION_PROGRAM_ID.toString()
);

// Seeds
export const RENT_PDA_SEED = Buffer.from("rent");
export const LAMPORTS_PDA_SEED = Buffer.from("lamports");
export const BUFFER_SEED = Buffer.from("buffer");
export const DELEGATION_RECORD_SEED = Buffer.from("delegation");
export const DELEGATION_METADATA_SEED = Buffer.from("delegation-metadata");

// Instruction discriminator (from e-token-api/src/lib.rs)
export const SPONSORED_LAMPORTS_TRANSFER_DISCRIMINATOR = 20;

// Sponsored lamports transfer setup fee (0.0003 SOL)
export const SPONSORED_LAMPORTS_TRANSFER_SETUP_LAMPORTS = 300_000n;

/**
 * Derive the global rent PDA — [b"rent"] with the e-token program.
 */
export function deriveRentPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [RENT_PDA_SEED],
    E_TOKEN_PROGRAM_ID
  )[0];
}

/**
 * Derive the lamports PDA — [b"lamports", payer, destination, salt].
 */
export function deriveLamportsPda(
  payer: PublicKey,
  destination: PublicKey,
  salt: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LAMPORTS_PDA_SEED, payer.toBuffer(), destination.toBuffer(), salt],
    E_TOKEN_PROGRAM_ID
  );
}

/**
 * Derive the delegation buffer PDA — [b"buffer", lamports_pda] with the
 * e-token program (the owner program is used for the buffer).
 */
export function deriveDelegationBuffer(lamportsPda: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [BUFFER_SEED, lamportsPda.toBuffer()],
    E_TOKEN_PROGRAM_ID
  )[0];
}

/**
 * Derive the delegation record PDA — [b"delegation", account] with the
 * DLP delegation program.
 */
export function deriveDelegationRecord(account: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [DELEGATION_RECORD_SEED, account.toBuffer()],
    E_TOKEN_DELEGATION_PROGRAM_ID
  )[0];
}

/**
 * Derive the delegation metadata PDA — [b"delegation-metadata", account]
 * with the DLP delegation program.
 */
export function deriveDelegationMetadata(account: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [DELEGATION_METADATA_SEED, account.toBuffer()],
    E_TOKEN_DELEGATION_PROGRAM_ID
  )[0];
}

/**
 * Generate a cryptographically random 32-byte salt.
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
