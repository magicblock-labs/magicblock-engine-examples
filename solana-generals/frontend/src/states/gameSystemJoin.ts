import { PublicKey } from "@solana/web3.js";
import { ApplySystem } from "@magicblock-labs/bolt-sdk";

import { MagicBlockEngine } from "../engine/MagicBlockEngine";
import {
  COMPONENT_GAME_PROGRAM_ID,
  SYSTEM_JOIN_PROGRAM_ID,
} from "./gamePrograms";
import { gameWorldGet } from "./gameWorld";

export async function gameSystemJoin(
  engine: MagicBlockEngine,
  entityPda: PublicKey,
  playerIndex: number,
  join: boolean
) {
  const worldPda = gameWorldGet();
  const applySystem = await ApplySystem({
    authority: engine.getSessionPayer(),
    systemId: SYSTEM_JOIN_PROGRAM_ID,
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
      join,
    },
  });
  return await engine.processSessionEphemTransaction(
    "SystemJoin:" + playerIndex,
    applySystem.transaction
  );
}
