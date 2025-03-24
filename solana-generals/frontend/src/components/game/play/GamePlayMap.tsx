import * as React from "react";

import { PublicKey } from "@solana/web3.js";

import { useMagicBlockEngine } from "../../../engine/MagicBlockEngineProvider";
import { MagicBlockQueue } from "../../../engine/MagicBlockQueue";

import { GameGridRows } from "../grid/GameGridRows";

import { gameSystemCommand } from "../../../states/gameSystemCommand";

export function GamePlayMap({
  entityPda,
  game,
}: {
  entityPda: PublicKey;
  game: any;
}) {
  const engine = useMagicBlockEngine();

  const queue = React.useMemo(() => {
    return new MagicBlockQueue(engine);
  }, [engine]);

  const [activity, setActivity] = React.useState({
    x: -1,
    y: -1,
  });

  const command = React.useRef({
    active: false,
    lastX: -1,
    lastY: -1,
    playerIndex: -1,
  });

  const onCommandStart = (targetX: number, targetY: number) => {
    if (!game.status.playing) {
      return;
    }
    const cell = game.cells[targetY * game.sizeX + targetX];
    if (!cell) {
      return;
    }
    if (!cell.owner.player) {
      return;
    }
    const playerIndex = cell.owner.player[0];
    const player = game.players[playerIndex];
    if (!player.authority.equals(engine.getSessionPayer())) {
      return;
    }
    console.log("onCommand.start", targetX, targetY, playerIndex);
    command.current = {
      active: true,
      lastX: targetX,
      lastY: targetY,
      playerIndex,
    };
    setActivity({
      x: targetX,
      y: targetY,
    });
  };

  const onCommandMove = (targetX: number, targetY: number) => {
    if (!command.current.active) {
      return;
    }

    const sourceX = command.current.lastX;
    const sourceY = command.current.lastY;
    if (sourceX === targetX && sourceY === targetY) {
      return;
    }

    const playerIndex = command.current.playerIndex;

    command.current = {
      active: true,
      lastX: targetX,
      lastY: targetY,
      playerIndex,
    };
    setActivity({
      x: targetX,
      y: targetY,
    });

    onCommandAttackRow(playerIndex, sourceX, sourceY, targetX);
    onCommandAttackColumn(playerIndex, targetX, sourceY, targetY);
  };

  const onCommandEnd = () => {
    if (!command.current.active) {
      return;
    }
    console.log("onCommand.end");
    command.current = {
      active: false,
      lastX: -1,
      lastY: -1,
      playerIndex: -1,
    };
    setActivity({ x: -1, y: -1 });
  };

  const onCommandAttackRow = (
    playerIndex: number,
    sourceX: number,
    sourceY: number,
    targetX: number
  ) => {
    if (sourceX < targetX) {
      for (let originX = sourceX; originX < targetX; originX++) {
        onCommandAttack(playerIndex, originX, sourceY, originX + 1, sourceY);
      }
    } else {
      for (let originX = sourceX; originX > targetX; originX--) {
        onCommandAttack(playerIndex, originX, sourceY, originX - 1, sourceY);
      }
    }
  };

  const onCommandAttackColumn = (
    playerIndex: number,
    sourceX: number,
    sourceY: number,
    targetY: number
  ) => {
    if (sourceY < targetY) {
      for (let originY = sourceY; originY < targetY; originY++) {
        onCommandAttack(playerIndex, sourceX, originY, sourceX, originY + 1);
      }
    } else {
      for (let originY = sourceY; originY > targetY; originY--) {
        onCommandAttack(playerIndex, sourceX, originY, sourceX, originY - 1);
      }
    }
  };

  const onCommandAttack = (
    playerIndex: number,
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number
  ) => {
    console.log(
      "onCommand.attack",
      sourceX + "x" + sourceY,
      targetX + "x" + targetY
    );
    gameSystemCommand(
      queue,
      entityPda,
      playerIndex,
      sourceX,
      sourceY,
      targetX,
      targetY,
      100
    ).then(
      (value: string) => {
        console.log(
          "onCommand.success",
          sourceX + "x" + sourceY,
          targetX + "x" + targetY,
          value
        );
      },
      (reason: any) => {
        console.warn(
          "onCommand.fail",
          sourceX + "x" + sourceY,
          targetX + "x" + targetY,
          reason?.message ?? reason
        );
      }
    );
  };

  const onCommand = (targetX: number, targetY: number, type: string) => {
    switch (type) {
      case "start": {
        return onCommandStart(targetX, targetY);
      }
      case "move": {
        return onCommandMove(targetX, targetY);
      }
      case "end": {
        return onCommandEnd();
      }
    }
  };

  return <GameGridRows game={game} activity={activity} onCommand={onCommand} />;
}
