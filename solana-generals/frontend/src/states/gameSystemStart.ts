import { PublicKey } from "@solana/web3.js";
import { ApplySystem } from "@magicblock-labs/bolt-sdk";

import { MagicBlockEngine } from "../engine/MagicBlockEngine";
import {
  COMPONENT_GAME_PROGRAM_ID,
  SYSTEM_START_PROGRAM_ID,
} from "./gamePrograms";
import { gameWorldGet } from "./gameWorld";

export async function gameSystemStart(
  engine: MagicBlockEngine,
  entityPda: PublicKey
) {
  const worldPda = gameWorldGet();
  const applySystem = await ApplySystem({
    authority: engine.getSessionPayer(),
    systemId: SYSTEM_START_PROGRAM_ID,
    world: worldPda,
    entities: [
      {
        entity: entityPda,
        components: [
          {
            componentId: COMPONENT_GAME_PROGRAM_ID,
          },
        ],
      },
    ],
  });
  return await engine.processSessionEphemTransaction(
    "SystemStart",
    applySystem.transaction
  );
}
