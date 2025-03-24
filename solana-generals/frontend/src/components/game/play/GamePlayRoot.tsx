import * as React from "react";

import { PublicKey } from "@solana/web3.js";

import { MagicBlockEngine } from "../../../engine/MagicBlockEngine";
import { useMagicBlockEngine } from "../../../engine/MagicBlockEngineProvider";

import { Text } from "../../util/Text";
import { ForEach } from "../../util/ForEach";

import { GamePlayer } from "../GamePlayer";
import { GamePlayMap } from "./GamePlayMap";

import { gameSystemTick } from "../../../states/gameSystemTick";
import { gameSystemFinish } from "../../../states/gameSystemFinish";
import { gameFetch } from "../../../states/gameFetch";

export function GamePlayRoot({
  entityPda,
  gamePda,
  game,
}: {
  entityPda: PublicKey;
  gamePda: PublicKey;
  game: any;
}) {
  const engine = useMagicBlockEngine();

  // When the page is loaded, run some logic
  React.useEffect(() => {
    return scheduleTick(engine, entityPda, gamePda);
  }, [engine, entityPda, gamePda]);
  React.useEffect(() => {
    return scheduleFinish(engine, entityPda, gamePda);
  }, [engine, entityPda, gamePda]);

  // Hint on game status
  let status = "?";
  if (game.status.playing) {
    status = "The game is in progress!";
  }
  if (game.status.finished) {
    status = "The game is finished.";
  }

  // Show the slot of the game
  status += " (tick slot: " + game.tickNextSlot.toString() + ")";

  return (
    <>
      <div
        className="Horizontal"
        style={{ border: "2px solid rgba(255, 255, 255, 0.3)" }}
      >
        <ForEach
          values={game.players}
          renderer={(player, index) => (
            <GamePlayer key={index} playerIndex={index} player={player} />
          )}
        />
      </div>
      <Text value="Drag and drop your army on the map" />
      <GamePlayMap entityPda={entityPda} game={game} />
      <Text value={status} />
    </>
  );
}

function scheduleTick(
  engine: MagicBlockEngine,
  entityPda: PublicKey,
  gamePda: PublicKey
) {
  // Run ticks as fast as possible
  console.log("start tick crank");
  let running = true;
  (async () => {
    const game = await gameFetch(engine, gamePda);
    if (!game) {
      return;
    }
    if (!game.status.playing) {
      return;
    }
    while (running) {
      // Wait a bit to avoid cloging the main thread
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Run the tick system and try again as soon as it succeed
      try {
        await gameSystemTick(engine, entityPda);
      } catch (error) {
        console.error("failed to tick the game", error);
      }
    }
  })();
  // on cleanup
  return () => {
    console.log("stop tick crank");
    running = false;
  };
}

function scheduleFinish(
  engine: MagicBlockEngine,
  entityPda: PublicKey,
  gamePda: PublicKey
) {
  // Every once in a while, run the finish check
  console.log("start finish checks");
  const interval = setInterval(async () => {
    try {
      const game = await gameFetch(engine, gamePda);
      if (!game) {
        return;
      }
      if (!game.status.playing) {
        return;
      }
      await gameSystemFinish(engine, entityPda, 0);
      await gameSystemFinish(engine, entityPda, 1);
    } catch (error) {
      console.error("failed to finish the game", error);
    }
  }, 5000);
  // On cleanup
  return () => {
    console.log("stop finish checks");
    clearInterval(interval);
  };
}
