import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Game } from "../target/types/game";
import { Generate } from "../target/types/generate";
import { Join } from "../target/types/join";
import { Start } from "../target/types/start";
import { Tick } from "../target/types/tick";
import { Finish } from "../target/types/finish";
import { Command } from "../target/types/command";
import {
  InitializeNewWorld,
  AddEntity,
  InitializeComponent,
  ApplySystem,
} from "@magicblock-labs/bolt-sdk";
import { expect } from "chai";

describe("Backend", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let worldPda: PublicKey;
  let entityPda: PublicKey;
  let gamePda: PublicKey;

  const gameComponent = anchor.workspace.Game as Program<Game>;

  const systemGenerate = anchor.workspace.Generate as Program<Generate>;
  const systemJoin = anchor.workspace.Join as Program<Join>;
  const systemStart = anchor.workspace.Start as Program<Start>;
  const systemTick = anchor.workspace.Tick as Program<Tick>;
  const systemCommand = anchor.workspace.Command as Program<Command>;
  const systemFinish = anchor.workspace.Finish as Program<Finish>;

  it("InitializeNewWorld", async () => {
    const initializeNewWorld = await InitializeNewWorld({
      payer: provider.wallet.publicKey,
      connection: provider.connection,
    });
    const signature = await provider.sendAndConfirm(
      initializeNewWorld.transaction
    );
    worldPda = initializeNewWorld.worldPda;
    console.log(
      `Initialized a new world (ID=${worldPda}). Initialization signature: ${signature}`
    );
  });

  it("AddEntity", async () => {
    const addEntity = await AddEntity({
      payer: provider.wallet.publicKey,
      world: worldPda,
      connection: provider.connection,
    });
    const signature = await provider.sendAndConfirm(addEntity.transaction);
    entityPda = addEntity.entityPda;
    console.log(
      `Initialized a new Entity (ID=${addEntity.entityId}). Initialization signature: ${signature}`
    );
  });

  it("Initialize Game", async () => {
    const initializeComponent = await InitializeComponent({
      payer: provider.wallet.publicKey,
      entity: entityPda,
      componentId: gameComponent.programId,
    });
    const signature = await provider.sendAndConfirm(
      initializeComponent.transaction
    );
    gamePda = initializeComponent.componentPda;
    console.log(
      `Initialized the grid component. Initialization signature: ${signature}`
    );
    await logGameInfos();
    await logGameCells();
  });

  it("Generate the map", async () => {
    await tryApplySystemOnGame({
      systemId: systemGenerate.programId,
      args: {
        map: 0,
      },
    });
    await logGameInfos();
    await logGameCells();
  });

  it("Player 1 joins slot 0", async () => {
    await tryApplySystemOnGame({
      systemId: systemJoin.programId,
      args: {
        player_index: 0,
        join: true,
      },
    });
    await logGameInfos();
  });

  it("Player 2 joins slot 1", async () => {
    await tryApplySystemOnGame({
      systemId: systemJoin.programId,
      args: {
        player_index: 1,
        join: true,
      },
    });
    await logGameInfos();
  });

  it("Start the game", async () => {
    await tryApplySystemOnGame({ systemId: systemStart.programId, args: {} });
    await logGameInfos();
  });

  it("Tick the game (#1)", async () => {
    await tryApplySystemOnGame({ systemId: systemTick.programId, args: {} });
    await logGameInfos();
    await logGameCells();
  });

  it("Player 1 makes a move", async () => {
    await tryApplySystemOnGame({
      systemId: systemCommand.programId,
      args: {
        player_index: 0,
        source_x: 1,
        source_y: 1,
        target_x: 1,
        target_y: 2,
        strength_percent: 100,
      },
    });
    await logGameInfos();
    await logGameCells();
  });

  it("Player 2 tries to claim victory, it should have no effect", async () => {
    await tryApplySystemOnGame({
      systemId: systemFinish.programId,
      args: {
        player_index: 1,
      },
    });
    await logGameInfos();
  });

  it("Player 2 makes a move", async () => {
    await tryApplySystemOnGame({
      systemId: systemCommand.programId,
      args: {
        player_index: 1,
        source_x: 14,
        source_y: 6,
        target_x: 13,
        target_y: 6,
        strength_percent: 100,
      },
    });
    await logGameInfos();
    await logGameCells();
  });

  async function tryApplySystemOnGame({
    systemId,
    args,
    expectedError,
  }: {
    systemId: PublicKey;
    args: {};
    expectedError?: string;
  }) {
    const applySystem = await ApplySystem({
      authority: provider.wallet.publicKey,
      system: systemId,
      entity: entityPda,
      components: [gameComponent.programId],
      args: args,
    });
    let success = true;
    try {
      const signature = await provider.sendAndConfirm(applySystem.transaction);
      console.log(`Applied a system. Signature: ${signature}`);
    } catch (error) {
      success = false;
      if (expectedError) {
        expect(error.toString()).to.include(expectedError);
      } else {
        console.log("unexpected error:", error);
      }
    }
    expect(success).to.equal(!expectedError);
  }

  async function logGameInfos() {
    const gameData = await gameComponent.account.game.fetch(gamePda);

    console.log("Game Status:");
    let status = "??";
    if (gameData.status.finished !== undefined) {
      status = "FINISHED";
    } else if (gameData.status.generate !== undefined) {
      status = "GENERATE";
    } else if (gameData.status.lobby !== undefined) {
      status = "LOBBY";
    } else if (gameData.status.playing !== undefined) {
      status = "PLAYING";
    }
    console.log(">", status);

    console.log("Game Players:");
    for (let i = 0; i < gameData.players.length; i++) {
      const player = gameData.players[i];
      console.log(
        ">",
        player.ready ? "[READY]" : "[ AFK ]",
        player.authority.toBase58()
      );
    }
  }

  async function logGameCells() {
    const gameData = await gameComponent.account.game.fetch(gamePda);

    console.log("Game Cells:");
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
      console.log(parts.join(""));
    }
  }
});
