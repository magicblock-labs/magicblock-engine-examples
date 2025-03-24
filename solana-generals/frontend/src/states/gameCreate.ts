import { Transaction } from "@solana/web3.js";
import {
  AddEntity,
  InitializeComponent,
  createAddEntityInstruction,
  createDelegateInstruction,
} from "@magicblock-labs/bolt-sdk";

import { MagicBlockEngine } from "../engine/MagicBlockEngine";

import { COMPONENT_GAME_PROGRAM_ID } from "./gamePrograms";
import { gameSystemGenerate } from "./gameSystemGenerate";
import { gameWorldGetOrCreate } from "./gameWorld";

export async function gameCreate(
  engine: MagicBlockEngine,
  onLog: (log: string) => void
) {
  // Choose the world we're using
  const worldPda = await gameWorldGetOrCreate(engine);
  // Create a new Entity
  onLog("Creating a new entity");
  const addEntity = await AddEntity({
    connection: engine.getConnectionChain(),
    payer: engine.getSessionPayer(),
    world: worldPda,
  });
  // Initialize the game component
  onLog("Initializing a new component");
  const initializeComponent = await InitializeComponent({
    payer: engine.getSessionPayer(),
    entity: addEntity.entityPda,
    componentId: COMPONENT_GAME_PROGRAM_ID,
  });
  // Delegate the game component
  onLog("Delegating to Ephem rollups");
  const delegateComponentInstruction = createDelegateInstruction(
    {
      entity: addEntity.entityPda,
      account: initializeComponent.componentPda,
      ownerProgram: COMPONENT_GAME_PROGRAM_ID,
      payer: engine.getSessionPayer(),
    },
    undefined,
    1_000_000_000 // We don't want to auto-commit the state of the game
  );
  // Execute all instructions at once
  onLog("Processing creation");
  await engine.processSessionChainTransaction(
    "DelegateComponent",
    new Transaction()
      .add(addEntity.instruction)
      .add(initializeComponent.instruction)
      .add(delegateComponentInstruction)
  );
  // Generate the game
  onLog("Generate the game");
  await gameSystemGenerate(engine, addEntity.entityPda);
  // Entity PDA for later use
  onLog("Game is ready!");
  return addEntity.entityPda;
}
