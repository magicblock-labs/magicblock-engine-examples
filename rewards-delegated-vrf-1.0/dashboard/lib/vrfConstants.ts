import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./constants";

/**
 * VRF Program Constants imported from shared test constants
 * Source: /tests/constants.ts
 * 
 * These constants are synchronized across the entire codebase.
 * If values change, update them in tests/constants.ts only.
 */

// VRF Program Constants
export const VRF_PROGRAM_ID = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
export const ORACLE_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
export const SLOT_HASHES_SYSVAR = new PublicKey("SysvarS1otHashes111111111111111111111111111");

// Test/Example Constants
export const TEST_WHITELIST_USER = new PublicKey("MBRsimXx8nMHvXYgRHLQeVQR3FDALK2eZeXfQ3fJeSv");

/**
 * Derive the VRF Program Identity PDA
 * This is used to validate that VRF callbacks come from the official VRF program
 * The identity PDA is derived from the callback program (this rewards program), not the VRF program
 * Seed: "identity", Program: rewards program (PROGRAM_ID)
 */
export function getVrfProgramIdentity(): PublicKey {
  const IDENTITY_SEED = Buffer.from("identity");
  const [programIdentity] = PublicKey.findProgramAddressSync(
    [IDENTITY_SEED],
    PROGRAM_ID
  );
  return programIdentity;
}

/**
 * All VRF-related accounts needed for requestRandomReward instruction
 */
export const VRF_ACCOUNTS = {
  vrfProgram: VRF_PROGRAM_ID,
  oracleQueue: ORACLE_QUEUE,
  slotHashes: SLOT_HASHES_SYSVAR,
} as const;
