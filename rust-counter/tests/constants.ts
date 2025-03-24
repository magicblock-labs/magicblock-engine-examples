import { PublicKey } from '@solana/web3.js';

// The delegation program ID.
export const DELEGATION_PROGRAM_ID: PublicKey = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

// The magic program ID.
export const MAGIC_PROGRAM_ID: PublicKey = new PublicKey("Magic11111111111111111111111111111111111111");

// The magic context ID.
export const MAGIC_CONTEXT_ID: PublicKey = new PublicKey("MagicContext1111111111111111111111111111111");

// The seed of the authority account PDA.
export const DELEGATION_RECORD: Uint8Array = Buffer.from("delegation");

// The account to store the delegated account seeds.
export const DELEGATION_METADATA: Uint8Array = Buffer.from("delegation-metadata");

// The seed of the buffer account PDA.
export const BUFFER: Uint8Array = Buffer.from("buffer");

// The seed of the committed state PDA.
export const COMMIT_STATE: Uint8Array = Buffer.from("state-diff");

// The seed of a commit state record PDA.
export const COMMIT_RECORD: Uint8Array = Buffer.from("commit-state-record");

// The discriminator for the external undelegate instruction.
export const EXTERNAL_UNDELEGATE_DISCRIMINATOR: Uint8Array = new Uint8Array([
  196, 28, 41, 206, 48, 37, 51, 167
]);

export const getDelegationBufferPda = (pdaToDelegate: PublicKey, programId: PublicKey) => {
    const [pda, bump] = PublicKey.findProgramAddressSync([BUFFER, pdaToDelegate.toBuffer()], programId)
    return pda
}

export const getDelegationRecordPda = (pdaToDelegate: PublicKey) => {
  const [pda, bump] = PublicKey.findProgramAddressSync([DELEGATION_RECORD, pdaToDelegate.toBuffer()], DELEGATION_PROGRAM_ID)
  return pda
}

export const getDelegationMetadataPda = (pdaToDelegate: PublicKey) => {
  const [pda, bump] = PublicKey.findProgramAddressSync([DELEGATION_METADATA, pdaToDelegate.toBuffer()], DELEGATION_PROGRAM_ID)
  return pda
}