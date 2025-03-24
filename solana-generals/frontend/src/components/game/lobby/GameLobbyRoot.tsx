import * as React from "react";

import { PublicKey } from "@solana/web3.js";

import { MagicBlockEngine } from "../../../engine/MagicBlockEngine";
import { useMagicBlockEngine } from "../../../engine/MagicBlockEngineProvider";

import { Text } from "../../util/Text";
import { ForEach } from "../../util/ForEach";

import { GameLobbyPlayer } from "./GameLobbyPlayer";

import { GameGridRows } from "../grid/GameGridRows";

import { gameFetch } from "../../../states/gameFetch";
import { gameSystemStart } from "../../../states/gameSystemStart";
import { gameSystemGenerate } from "../../../states/gameSystemGenerate";

export function GameLobbyRoot({
  entityPda,
  gamePda,
  game,
}: {
  entityPda: PublicKey;
  gamePda: PublicKey;
  game: any;
}) {
  const engine = useMagicBlockEngine();

  React.useEffect(() => {
    return scheduleGenerateOrStart(engine, entityPda, gamePda);
  }, [engine, entityPda, gamePda]);

  return (
    <>
      <div style={{ border: "2px solid rgba(255, 255, 255, 0.3)" }}>
        <ForEach
          values={game.players}
          renderer={(player, index) => (
            <GameLobbyPlayer
              key={index}
              playerIndex={index}
              player={player}
              entityPda={entityPda}
            />
          )}
        />
      </div>
      <Text value="Map Preview" />
      <GameGridRows game={game} />
    </>
  );
}

function scheduleGenerateOrStart(
  engine: MagicBlockEngine,
  entityPda: PublicKey,
  gamePda: PublicKey
) {
  const interval = setInterval(async () => {
    const game = await gameFetch(engine, gamePda);
    if (!game) {
      return;
    }
    if (game.status.generate) {
      await gameSystemGenerate(engine, entityPda);
    }
    if (game.status.lobby) {
      let canStart = !!game.status.lobby;
      game.players.forEach((player: any) => {
        if (!player.ready) {
          canStart = false;
        }
      });
      if (canStart) {
        await gameSystemStart(engine, entityPda);
      }
    }
  }, 2000);
  return () => {
    clearInterval(interval);
  };
}
