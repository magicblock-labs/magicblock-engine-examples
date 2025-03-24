import { PublicKey } from "@solana/web3.js";

export function gameLog(gamePda: PublicKey, gameData: any) {
  if (!gameData) {
    return;
  }

  const lines = [];

  const header = [];
  header.push("gameLog");
  let status = "??";
  if (gameData.status.finished !== undefined) {
    status = "(FINISHED)";
  } else if (gameData.status.generate !== undefined) {
    status = "(GENERATE)";
  } else if (gameData.status.lobby !== undefined) {
    status = "(LOBBY)";
  } else if (gameData.status.playing !== undefined) {
    status = "(PLAYING)";
  }
  header.push(status);
  header.push("<" + gameData.tickNextSlot.toString() + ">");
  header.push(gamePda.toBase58());
  lines.push(header.join(" "));

  lines.push("--");

  for (let i = 0; i < gameData.players.length; i++) {
    const player = gameData.players[i];
    const parts = [];
    if (player.ready) {
      parts.push("[ READY ]");
    } else {
      parts.push("[WAITING]");
    }
    parts.push(player.authority.toBase58());
    lines.push(parts.join(" "));
  }

  lines.push("--");

  for (let y = 0; y < gameData.sizeY; y++) {
    const parts = [];
    for (let x = 0; x < gameData.sizeX; x++) {
      const cell = gameData.cells[y * gameData.sizeX + x];
      parts.push("|");

      if (cell.owner.nobody !== undefined) {
        parts.push(" ");
      } else if (cell.owner.player !== undefined) {
        if (cell.owner.player[0] == 0) {
          parts.push("A");
        } else if (cell.owner.player[0] == 1) {
          parts.push("B");
        } else {
          parts.push("?");
        }
      } else {
        parts.push("?");
      }

      if (cell.kind.capital !== undefined) {
        parts.push("$");
      } else if (cell.kind.city !== undefined) {
        parts.push("X");
      } else if (cell.kind.field !== undefined) {
        parts.push(" ");
      } else if (cell.kind.mountain !== undefined) {
        parts.push("M");
      } else if (cell.kind.forest !== undefined) {
        parts.push("F");
      } else {
        parts.push("?");
      }

      if (cell.strength == 0) {
        parts.push(" ");
      } else if (cell.strength < 10) {
        parts.push(cell.strength.toString());
      } else {
        parts.push("+");
      }
    }
    parts.push("|");
    lines.push(parts.join(""));
  }
  console.log(lines.join("\n"));
}
