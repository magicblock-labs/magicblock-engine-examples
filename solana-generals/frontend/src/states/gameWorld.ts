import {
  createInitializeRegistryInstruction,
  FindRegistryPda,
  InitializeNewWorld,
} from "@magicblock-labs/bolt-sdk";
import { MagicBlockEngine } from "../engine/MagicBlockEngine";
import { PublicKey, Transaction } from "@solana/web3.js";

const EXPECTED_WORLD_PDA = new PublicKey(
  "JBupPMmv4zaXa5c8EdubsCPvoHZwCK7mwnDfmfs8dC5Y"
);

export function gameWorldGet(): PublicKey {
  return EXPECTED_WORLD_PDA;
}

export async function gameWorldGetOrCreate(
  engine: MagicBlockEngine
): Promise<PublicKey> {
  // If possible, try to get an airdrop for when we are working with devnet/testnet/localnet
  try {
    await engine.fundSessionFromAirdrop();
  } catch (error) {
    console.log("Could not airdrop to fund the session key");
  }
  // Check if the registry exists, or try to create it
  const registryPda = FindRegistryPda({});
  const registryAccountInfo = await engine.getChainAccountInfo(registryPda);
  if (registryAccountInfo === null) {
    const initializeRegistryIx = createInitializeRegistryInstruction({
      registry: registryPda,
      payer: engine.getSessionPayer(),
    });
    await engine.processSessionChainTransaction(
      "InitializeRegistry",
      new Transaction().add(initializeRegistryIx)
    );
    console.log("Initialized Registry");
  }
  // Check if the world exists, or try to create it
  const worldPda = EXPECTED_WORLD_PDA;
  const worldAccountInfo = await engine.getChainAccountInfo(worldPda);
  if (worldAccountInfo === null) {
    const initializeNewWorld = await InitializeNewWorld({
      connection: engine.getConnectionChain(),
      payer: engine.getSessionPayer(),
    });
    console.log("InitializeNewWorld", initializeNewWorld);
    await engine.processSessionChainTransaction(
      "InitializeNewWorld",
      initializeNewWorld.transaction
    );
  }
  // By now, we hopefully have a valid world we can use as expected
  return worldPda;
}
