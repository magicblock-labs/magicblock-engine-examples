import {
  FindComponentPda,
  FindEntityPda,
  World,
} from "@magicblock-labs/bolt-sdk";

import { MagicBlockEngine } from "../engine/MagicBlockEngine";

import { getComponentGameOnChain } from "./gamePrograms";
import { gameWorldGetOrCreate } from "./gameWorld";

export async function gameList(engine: MagicBlockEngine, count: number) {
  const componentGame = getComponentGameOnChain(engine);
  const worldPda = await gameWorldGetOrCreate(engine);

  const world = await World.fromAccountAddress(
    engine.getConnectionChain(),
    worldPda
  );

  let entityId = world.entities;

  const found: any[] = [];
  while (!entityId.isNeg() && found.length < count) {
    // Create a batch of accounts PDAs to read
    const batch: any[] = [];
    while (!entityId.isNeg() && batch.length <= 100) {
      const entityPda = FindEntityPda({
        worldId: world.id,
        entityId: entityId,
      });
      const gamePda = FindComponentPda({
        componentId: componentGame.programId,
        entity: entityPda,
      });
      batch.push({
        entityId: entityId.toString(),
        entityPda: entityPda,
        gamePda: gamePda,
      });
      entityId = entityId.subn(1);
    }
    // Fetch multiple games at the same time
    const games = await componentGame.account.game.fetchMultiple(
      batch.map((entry) => entry.gamePda)
    );
    games.forEach((game, index) => {
      const entry = batch[index];
      const entityId = entry.entityId;
      const entityPda = entry.entityPda;
      const gamePda = entry.gamePda;
      console.log("Check game", entityId, game);
      if (game && found.length < count) {
        found.push({
          entityPda,
          entityId,
          gamePda,
          game,
        });
      }
    });
  }
  return found;
}
