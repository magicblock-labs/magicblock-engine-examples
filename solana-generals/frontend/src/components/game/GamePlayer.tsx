import * as React from "react";

import { useMagicBlockEngine } from "../../engine/MagicBlockEngineProvider";

import { Text } from "../util/Text";

import "./GamePlayer.scss";

export function GamePlayer({
  playerIndex,
  player,
}: {
  playerIndex: number;
  player: any;
}) {
  const engine = useMagicBlockEngine();

  const name = "Player " + (playerIndex + 1);
  let description;
  if (player.ready) {
    if (player.authority.equals(engine.getSessionPayer())) {
      description = "You are the player";
    } else {
      description =
        "Owner: " + player.authority.toBase58().substring(0, 8) + "...";
    }
  } else {
    description = "Waiting for someone to join";
  }

  return (
    <div
      className={[
        "GamePlayer",
        "Horizontal",
        "Centered",
        "P" + playerIndex,
      ].join(" ")}
    >
      <Text value={name} />
      <Text value={description} isFading={true} />
    </div>
  );
}
