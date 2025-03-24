import * as React from "react";

import { GameGridCell } from "./GameGridCell";

import "./GameGridRows.scss";

export function GameGridRows({
  game,
  activity,
  onCommand,
}: {
  game: any;
  activity?: { x: number; y: number };
  onCommand?: (x: number, y: number, type: string) => void;
}) {
  const rows = [];

  // Change the display scale and direction depending on window size
  const [rendering, setRendering] = React.useState(computeRendering(game));
  React.useEffect(() => {
    function onResize() {
      setRendering(computeRendering(game));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [game]);

  // If we want to render the game horizontally (for laptop/desktop)
  if (rendering.horizontal) {
    for (let y = 0; y < game.sizeY; y++) {
      const cells = [];
      for (let x = 0; x < game.sizeX; x++) {
        cells.push(
          <GameGridCell
            key={x}
            x={x}
            y={y}
            size={rendering.size}
            game={game}
            active={activity ? activity.x == x && activity.y == y : false}
            onCommand={onCommand}
          />
        );
      }
      rows.push(
        <div key={y} className="Row">
          {cells}
        </div>
      );
    }
  }
  // If we want to render ghe game vertically (for mobile)
  else {
    for (let x = 0; x < game.sizeX; x++) {
      const cells = [];
      for (let y = game.sizeY - 1; y >= 0; y--) {
        cells.push(
          <GameGridCell
            key={y}
            x={x}
            y={y}
            size={rendering.size}
            game={game}
            active={activity ? activity.x == x && activity.y == y : false}
            onCommand={onCommand}
          />
        );
      }
      rows.push(
        <div key={x} className="Row">
          {cells}
        </div>
      );
    }
  }

  return (
    <div className="GameGridRows">
      <div className="Rows">{rows}</div>
    </div>
  );
}

function computeRendering(game: any) {
  const horizontalSize = computeCellSize(game.sizeX, game.sizeY);
  const verticalSize = computeCellSize(game.sizeY, game.sizeX);
  if (verticalSize > horizontalSize) {
    return {
      horizontal: false,
      size: verticalSize,
    };
  }
  return {
    horizontal: true,
    size: horizontalSize,
  };
}

function computeCellSize(gameSizeX: number, gameSizeY: number) {
  const spaceX = window.innerWidth;
  const spaceY = window.innerHeight / 1.75;

  const sizeForX = Math.floor(spaceX / gameSizeX / 4 - 1) * 4;
  const sizeForY = Math.floor(spaceY / gameSizeY / 4 - 1) * 4;

  return Math.min(Math.min(sizeForX, sizeForY), 64);
}
