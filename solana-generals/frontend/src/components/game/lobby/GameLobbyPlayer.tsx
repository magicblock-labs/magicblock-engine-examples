import * as React from "react";
import { PublicKey } from "@solana/web3.js";
import { useMagicBlockEngine } from "../../../engine/MagicBlockEngineProvider";
import { Button } from "../../util/Button";
import { GamePlayer } from "../GamePlayer";
import { gameSystemJoin } from "../../../states/gameSystemJoin";

export function GameLobbyPlayer({
  playerIndex,
  player,
  entityPda,
}: {
  playerIndex: number;
  player: any;
  entityPda: PublicKey;
}) {
  const engine = useMagicBlockEngine();

  let button;
  if (!player.ready) {
    button = (
      <Button
        text="Join"
        onClick={async () => {
          await gameSystemJoin(engine, entityPda, playerIndex, true);
        }}
      />
    );
  } else if (player.authority.equals(engine.getSessionPayer())) {
    button = (
      <Button
        text="Leave"
        onClick={async () => {
          await gameSystemJoin(engine, entityPda, playerIndex, false);
        }}
      />
    );
  } else {
    button = <></>;
  }

  return (
    <div className="Horizontal">
      <GamePlayer playerIndex={playerIndex} player={player} />
      {button}
    </div>
  );
}
