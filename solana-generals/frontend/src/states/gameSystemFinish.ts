import { PublicKey } from "@solana/web3.js";
import { ApplySystem } from "@magicblock-labs/bolt-sdk";

import { MagicBlockEngine } from "../engine/MagicBlockEngine";
import {
  SYSTEM_FINISH_PROGRAM_ID,
  COMPONENT_GAME_PROGRAM_ID,
} from "./gamePrograms";
import { gameWorldGet } from "./gameWorld";

export async function gameSystemFinish(
  engine: MagicBlockEngine,
  entityPda: PublicKey,
  playerIndex: number
) {
  const worldPda = gameWorldGet();
  const applySystem = await ApplySystem({
    authority: engine.getSessionPayer(),
    systemId: SYSTEM_FINISH_PROGRAM_ID,
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
    args: {
      player_index: playerIndex,
    },
  });
  return await engine.processSessionEphemTransaction(
    "SystemFinish:" + playerIndex,
    applySystem.transaction
  );
}
