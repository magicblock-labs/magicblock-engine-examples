import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  AccountMeta,
  SystemProgram,
} from "@solana/web3.js";
import {
  E_TOKEN_PROGRAM_ID,
  E_TOKEN_DELEGATION_PROGRAM_ID,
  SPONSORED_LAMPORTS_TRANSFER_DISCRIMINATOR,
  deriveRentPda,
  deriveLamportsPda,
  deriveDelegationBuffer,
  deriveDelegationRecord,
  deriveDelegationMetadata,
  generateSalt,
} from "@/lib/eTokenConstants";

/**
 * Fetch the delegation record for the reward list PDA on the Solana base layer
 * and verify it is owned by the DLP — i.e. the account is currently delegated.
 * Mirrors the on-chain assert_owner!(destination_info, &DELEGATION_PROGRAM_ID).
 */
export async function checkRewardListDelegated(
  connection: Connection,
  rewardListPda: PublicKey
): Promise<boolean> {
  const delegationRecord = deriveDelegationRecord(rewardListPda);
  const info = await connection.getAccountInfo(delegationRecord);
  return !!info && info.owner.equals(E_TOKEN_DELEGATION_PROGRAM_ID);
}

/**
 * Build the SponsoredLamportsTransfer instruction (e-token program discriminator 20).
 * A fresh random salt is generated per call.
 *
 * Instruction data layout:
 *   [0]      discriminator  u8
 *   [1..9]   amount         u64 LE
 *   [9..41]  salt           [u8; 32]
 */
export function buildSponsoredLamportsTransfer(
  publicKey: PublicKey,
  rewardListPda: PublicKey,
  amountLamports: bigint
): { tx: Transaction; salt: Uint8Array } {
  const salt = generateSalt();
  const rentPda = deriveRentPda();
  const [lamportsPda] = deriveLamportsPda(publicKey, rewardListPda, salt);
  const bufferPda = deriveDelegationBuffer(lamportsPda);
  const delegationRecord = deriveDelegationRecord(lamportsPda);
  const delegationMetadata = deriveDelegationMetadata(lamportsPda);
  const destinationDelegationRecord = deriveDelegationRecord(rewardListPda);

  const data = Buffer.alloc(41);
  data.writeUInt8(SPONSORED_LAMPORTS_TRANSFER_DISCRIMINATOR, 0);
  data.writeBigUInt64LE(amountLamports, 1);
  data.set(salt, 9);

  const accounts: AccountMeta[] = [
    { pubkey: publicKey,                     isSigner: true,  isWritable: false }, // payer
    { pubkey: rentPda,                       isSigner: false, isWritable: true  }, // rent_pda
    { pubkey: lamportsPda,                   isSigner: false, isWritable: true  }, // lamports_pda
    { pubkey: E_TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false }, // owner_program
    { pubkey: bufferPda,                     isSigner: false, isWritable: true  }, // buffer_acc
    { pubkey: delegationRecord,              isSigner: false, isWritable: true  }, // delegation_record
    { pubkey: delegationMetadata,            isSigner: false, isWritable: true  }, // delegation_metadata
    { pubkey: E_TOKEN_DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false }, // delegation_program
    { pubkey: SystemProgram.programId,       isSigner: false, isWritable: false }, // system_program
    { pubkey: rewardListPda,                 isSigner: false, isWritable: true  }, // destination
    { pubkey: destinationDelegationRecord,   isSigner: false, isWritable: false }, // destination_delegation_record
  ];

  const tx = new Transaction().add(
    new TransactionInstruction({ programId: E_TOKEN_PROGRAM_ID, keys: accounts, data })
  );

  return { tx, salt };
}
