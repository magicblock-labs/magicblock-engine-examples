import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { MagicSVM } from "@magicblock-labs/magicsvm";
import {
  airdropOrThrow,
  dummyAnchorProvider,
  EPHEMERAL_VAULT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  permissionPdaFromAccount,
  sendSvmTx,
} from "@magicblock-labs/test-utils";
import BN from "bn.js";
import * as path from "path";

import {
  AUTHORITY_FLAG,
  Member,
  TX_LOGS_FLAG,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const PROGRAM_SO = path.resolve(
  __dirname,
  "../target/deploy/anchor_rock_paper_scissor.so",
);
const IDL = require("../target/idl/anchor_rock_paper_scissor.json");

type Choice = { rock: {} } | { paper: {} } | { scissors: {} };

function encodeProgram(payer: Keypair): Program {
  return new Program(IDL as anchor.Idl, dummyAnchorProvider(payer));
}

describe("anchor-rock-paper-scissor (magicsvm)", () => {
  const svm = new MagicSVM();
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();
  const programId = new PublicKey(IDL.address);
  const validator = new PublicKey(svm.validatorIdentity().toString());
  const program = encodeProgram(player1);

  console.log("Program ID: ", programId.toString());
  console.log("MagicSVM validator identity: ", validator.toBase58());

  const gameId = new BN(1);
  const STAKE = new BN(0.05 * anchor.web3.LAMPORTS_PER_SOL);
  const TARGET_WINS = 2;

  const GAME_SEED = Buffer.from("game");
  const PLAYER_CHOICE_SEED = Buffer.from("player_choice");
  const VAULT_SEED = Buffer.from("vault");

  const [gamePda] = PublicKey.findProgramAddressSync(
    [GAME_SEED, gameId.toArrayLike(Buffer, "le", 8)],
    programId,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, gameId.toArrayLike(Buffer, "le", 8)],
    programId,
  );
  const [player1ChoicePda] = PublicKey.findProgramAddressSync(
    [
      PLAYER_CHOICE_SEED,
      gameId.toArrayLike(Buffer, "le", 8),
      player1.publicKey.toBuffer(),
    ],
    programId,
  );
  const [player2ChoicePda] = PublicKey.findProgramAddressSync(
    [
      PLAYER_CHOICE_SEED,
      gameId.toArrayLike(Buffer, "le", 8),
      player2.publicKey.toBuffer(),
    ],
    programId,
  );

  const permissionForGame = permissionPdaFromAccount(gamePda);
  const permissionForPlayer1Choice = permissionPdaFromAccount(player1ChoicePda);
  const permissionForPlayer2Choice = permissionPdaFromAccount(player2ChoicePda);

  function decodeGame(target: "base" | "ephemeral") {
    const account = svm.getAccountFor(gamePda, { target });
    if (!account.exists) {
      throw new Error(`game PDA missing on ${target}`);
    }
    return program.coder.accounts.decode("game", Buffer.from(account.data));
  }

  function decodeChoice(pda: PublicKey, target: "base" | "ephemeral") {
    const account = svm.getAccountFor(pda, { target });
    if (!account.exists) {
      return null;
    }
    return program.account.playerChoice.coder.accounts.decode(
      "playerChoice",
      Buffer.from(account.data),
    );
  }

  it("Airdrop SOL to both players and load program", () => {
    svm.addProgramFromFile(programId, PROGRAM_SO);
    airdropOrThrow(svm, player1.publicKey, 2n * 1_000_000_000n);
    airdropOrThrow(svm, player2.publicKey, 2n * 1_000_000_000n);

    const balance1 = svm.getBalance(player1.publicKey);
    const balance2 = svm.getBalance(player2.publicKey);
    console.log(
      "💸 Player 1 Balance:",
      Number(balance1) / 1_000_000_000,
      "SOL",
    );
    console.log(
      "💸 Player 2 Balance:",
      Number(balance2) / 1_000_000_000,
      "SOL",
    );

    const permissionProgram = svm.getAccountFor(PERMISSION_PROGRAM_ID, {
      target: "ephemeral",
    });
    console.log(
      "PERMISSION_PROGRAM_ID on ephemeral:",
      permissionProgram.exists
        ? `executable=${permissionProgram.executable}`
        : "MISSING",
    );
    const magicProgram = svm.getAccountFor(MAGIC_PROGRAM_ID, {
      target: "ephemeral",
    });
    const vault = svm.getAccountFor(EPHEMERAL_VAULT_ID, {
      target: "ephemeral",
    });
    console.log(
      "MAGIC_PROGRAM_ID on ephemeral:",
      magicProgram.exists ? `executable=${magicProgram.executable}` : "MISSING",
    );
    console.log(
      "ephemeral vault on ephemeral:",
      vault.exists ? `lamports=${vault.lamports}` : "MISSING",
    );
  });

  it("Create Game by Player 1 (base: create + delegate p1_choice)", async () => {
    const createGameIx = await program.methods
      .createGame(gameId, STAKE, TARGET_WINS)
      .accountsPartial({
        game: gamePda,
        playerChoice: player1ChoicePda,
        vault: vaultPda,
        player1: player1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const delegatePlayer1ChoiceIx = await program.methods
      .delegatePda({ playerChoice: { gameId, player: player1.publicKey } })
      .accounts({
        payer: player1.publicKey,
        validator,
        pda: player1ChoicePda,
      })
      .instruction();

    const tx = new Transaction().add(createGameIx, delegatePlayer1ChoiceIx);
    sendSvmTx(svm, [player1], tx, "base", "create game + delegate p1 choice");
    console.log("✅ Game Created + P1 Choice Delegated");
  });

  it("Init ephemeral permission for Player 1 Choice (ER)", async () => {
    const onEr = svm.getAccountFor(player1ChoicePda, { target: "ephemeral" });
    if (!onEr.exists) {
      throw new Error("player1_choice not on ER after delegation");
    }

    const p1Members: Member[] = [
      { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player1.publicKey },
    ];
    const initP1ChoicePermissionIx = await program.methods
      .initPermission(
        { playerChoice: { gameId, player: player1.publicKey } },
        p1Members,
      )
      .accountsPartial({
        permissionedAccount: player1ChoicePda,
        permission: permissionForPlayer1Choice,
        authority: player1.publicKey,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction().add(initP1ChoicePermissionIx);
    sendSvmTx(svm, [player1], tx, "ephemeral", "init p1 choice permission");
    console.log("✅ P1 Choice permission initialized");

    const permission = svm.getAccountFor(permissionForPlayer1Choice, {
      target: "ephemeral",
    });
    if (!permission.exists) {
      throw new Error(
        "Player 1 Choice permission never activated in-process (waitUntilPermissionActive equivalent)",
      );
    }
    console.log("✅ Player 1 Choice permission active");
  });

  it("Join Game (Player 2) — base: join + delegate game + delegate p2_choice", async () => {
    const joinGameIx = await program.methods
      .joinGame(gameId)
      .accountsPartial({
        game: gamePda,
        playerChoice: player2ChoicePda,
        vault: vaultPda,
        player: player2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const delegateGameIx = await program.methods
      .delegatePda({ game: { gameId } })
      .accounts({
        payer: player2.publicKey,
        validator,
        pda: gamePda,
      })
      .instruction();

    const delegatePlayer2ChoiceIx = await program.methods
      .delegatePda({ playerChoice: { gameId, player: player2.publicKey } })
      .accounts({
        payer: player2.publicKey,
        validator,
        pda: player2ChoicePda,
      })
      .instruction();

    const tx = new Transaction().add(
      joinGameIx,
      delegateGameIx,
      delegatePlayer2ChoiceIx,
    );
    sendSvmTx(
      svm,
      [player2],
      tx,
      "base",
      "join game + delegate game + p2 choice",
    );
    console.log(
      `✅ Player 2 joined game ${gameId} + delegated game + p2 choice`,
    );
  });

  it("Init ephemeral permissions for Game + Player 2 Choice (ER)", async () => {
    if (!svm.getAccountFor(gamePda, { target: "ephemeral" }).exists) {
      throw new Error("game not on ER after delegation");
    }
    if (!svm.getAccountFor(player2ChoicePda, { target: "ephemeral" }).exists) {
      throw new Error("player2_choice not on ER after delegation");
    }

    const gameMembers: Member[] = [
      { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player1.publicKey },
      { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player2.publicKey },
    ];
    const initGamePermissionIx = await program.methods
      .initPermission({ game: { gameId } }, gameMembers)
      .accountsPartial({
        permissionedAccount: gamePda,
        permission: permissionForGame,
        authority: player2.publicKey,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .instruction();

    const p2Members: Member[] = [
      { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player2.publicKey },
    ];
    const initP2ChoicePermissionIx = await program.methods
      .initPermission(
        { playerChoice: { gameId, player: player2.publicKey } },
        p2Members,
      )
      .accountsPartial({
        permissionedAccount: player2ChoicePda,
        permission: permissionForPlayer2Choice,
        authority: player2.publicKey,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction().add(
      initGamePermissionIx,
      initP2ChoicePermissionIx,
    );
    sendSvmTx(
      svm,
      [player2],
      tx,
      "ephemeral",
      "init game + p2 choice permissions",
    );
    console.log("✅ Game + P2 Choice permissions initialized");

    const permission = svm.getAccountFor(permissionForPlayer2Choice, {
      target: "ephemeral",
    });
    if (!permission.exists) {
      throw new Error(
        "Player 2 Choice permission never activated in-process (waitUntilPermissionActive equivalent)",
      );
    }
    console.log("✅ Player 2 Choice permission active");
  });

  it("Round 1: Player 1 Makes Choice (Rock)", async () => {
    const choice: Choice = { rock: {} };
    const makeChoice1Ix = await program.methods
      .makeChoice(gameId, choice)
      .accounts({
        // @ts-ignore
        playerChoice: player1ChoicePda,
        player: player1.publicKey,
      })
      .instruction();

    const tx = new Transaction().add(makeChoice1Ix);
    sendSvmTx(svm, [player1], tx, "ephemeral", "p1 make choice");
    console.log(
      `✅ Player 1 ${player1.publicKey} chose ${JSON.stringify(choice)}`,
    );
  });

  it("Round 1: Player 2 Makes Choice (Scissors)", async () => {
    const choice: Choice = { scissors: {} };
    const makeChoice2Ix = await program.methods
      .makeChoice(gameId, choice)
      .accounts({
        // @ts-ignore
        playerChoice: player2ChoicePda,
        player: player2.publicKey,
      })
      .instruction();

    const tx = new Transaction().add(makeChoice2Ix);
    sendSvmTx(svm, [player2], tx, "ephemeral", "p2 make choice");
    console.log(
      `✅ Player 2 ${player2.publicKey} chose ${JSON.stringify(choice)}`,
    );
  });

  it("Player 1 checks own choice", () => {
    svm.setAuthorizedUser(player1.publicKey);
    const player1ChoiceAccount = decodeChoice(player1ChoicePda, "ephemeral");
    if (!player1ChoiceAccount) {
      throw new Error("Player 1 cannot read own choice");
    }
    console.log(`👀 Check Player 1 own Choice:`, player1ChoiceAccount.choice);
  });

  it("Player 2 check own choice", () => {
    svm.setAuthorizedUser(player2.publicKey);
    const player2ChoiceAccount = decodeChoice(player2ChoicePda, "ephemeral");
    if (!player2ChoiceAccount) {
      throw new Error("Player 2 cannot read own choice");
    }
    console.log(`👀 Check Player 2 own Choice:`, player2ChoiceAccount.choice);
  });

  it("Sneak Player 1 Choice", () => {
    svm.setAuthorizedUser(player2.publicKey);
    const accountInfo = svm.getAccountFor(player1ChoicePda, {
      target: "ephemeral",
    });
    if (!accountInfo.exists) {
      console.log(`✅ Player 1 choice account not found — as expected.`);
      return;
    }
    throw new Error("❌ Player 1 choice account exists unexpectedly!");
  });

  it("Sneak Player 2 Choice", () => {
    svm.setAuthorizedUser(player1.publicKey);
    const accountInfo = svm.getAccountFor(player2ChoicePda, {
      target: "ephemeral",
    });
    if (!accountInfo.exists) {
      console.log("✅ Player 2 choice account not found — as expected.");
      return;
    }
    throw new Error("❌ Player 2 choice account exists unexpectedly!");
  });

  it("Round 1: Reveal Winner (Player 1 leads 1-0)", async () => {
    const tx = await program.methods
      .revealRound()
      .accountsPartial({
        //@ts-ignore
        game: gamePda,
        player1Choice: player1ChoicePda,
        player2Choice: player2ChoicePda,
        permissionGame: permissionForGame,
        permission1: permissionForPlayer1Choice,
        permission2: permissionForPlayer2Choice,
        payer: player1.publicKey,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .transaction();
    sendSvmTx(svm, [player1], tx, "ephemeral", "reveal round 1");
    console.log("✅ Round 1 Reveal TX Sent");

    const gameAccount = decodeGame("ephemeral");
    printGameResult(gameAccount);
    if (gameAccount.player1Wins !== 1 || gameAccount.player2Wins !== 0) {
      throw new Error(
        `❌ Expected score 1-0, got ${gameAccount.player1Wins}-${gameAccount.player2Wins}`,
      );
    }
    console.log(
      `🏅 Score: ${gameAccount.player1Wins}-${gameAccount.player2Wins} (match in progress)`,
    );
  });

  it("Advance to Round 2 (score carries over)", async () => {
    const tx = await program.methods
      .nextRound()
      .accountsPartial({
        game: gamePda,
        player1Choice: player1ChoicePda,
        player2Choice: player2ChoicePda,
        permissionGame: permissionForGame,
        permission1: permissionForPlayer1Choice,
        permission2: permissionForPlayer2Choice,
        payer: player2.publicKey,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .transaction();
    sendSvmTx(svm, [player2], tx, "ephemeral", "next round");
    console.log("➡️  Advanced to round 2");

    const gameAccount = decodeGame("ephemeral");
    if (!("none" in gameAccount.roundResult)) {
      throw new Error("❌ Round result was not cleared");
    }
    if (gameAccount.round !== 2) {
      throw new Error(`❌ Expected round 2, got ${gameAccount.round}`);
    }
    if (gameAccount.player1Wins !== 1) {
      throw new Error("❌ Score should carry over to round 2");
    }
    console.log("✅ Round 2 ready, score preserved at 1-0");
  });

  it("Round 2: both players make a choice (P1 Rock, P2 Scissors)", async () => {
    const choices: Record<string, Choice> = {
      p1: { rock: {} },
      p2: { scissors: {} },
    };
    for (const [player, choicePda, key] of [
      [player1, player1ChoicePda, "p1"],
      [player2, player2ChoicePda, "p2"],
    ] as const) {
      const choice = choices[key];
      const ix = await program.methods
        .makeChoice(gameId, choice)
        .accounts({
          // @ts-ignore
          playerChoice: choicePda,
          player: player.publicKey,
        })
        .instruction();
      const tx = new Transaction().add(ix);
      sendSvmTx(svm, [player], tx, "ephemeral", `round 2 ${key} choice`);
      console.log(
        `✅ Round 2: ${player.publicKey} chose ${JSON.stringify(choice)}`,
      );
    }
  });

  it("Round 2: Sneak Player 2 Choice (private again after reset)", () => {
    svm.setAuthorizedUser(player1.publicKey);
    const accountInfo = svm.getAccountFor(player2ChoicePda, {
      target: "ephemeral",
    });
    if (!accountInfo.exists) {
      console.log(
        "✅ Player 2 choice hidden from Player 1 again — reset re-privatized it.",
      );
      return;
    }
    throw new Error("❌ Player 2 choice readable after reset!");
  });

  it("Round 2: Reveal Winner (Player 1 wins the match 2-0)", async () => {
    const tx = await program.methods
      .revealRound()
      .accountsPartial({
        //@ts-ignore
        game: gamePda,
        player1Choice: player1ChoicePda,
        player2Choice: player2ChoicePda,
        permissionGame: permissionForGame,
        permission1: permissionForPlayer1Choice,
        permission2: permissionForPlayer2Choice,
        payer: player1.publicKey,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .transaction();
    sendSvmTx(svm, [player1], tx, "ephemeral", "reveal round 2");
    console.log("✅ Round 2 Reveal Winner TX Sent");

    const gameAccount = decodeGame("ephemeral");
    printGameResult(gameAccount);
    if (gameAccount.player1Wins !== 2) {
      throw new Error(
        `❌ Expected Player 1 at 2 wins, got ${gameAccount.player1Wins}`,
      );
    }
    console.log(
      `🏆 Match decided ${gameAccount.player1Wins}-${gameAccount.player2Wins} after ${gameAccount.round} rounds`,
    );
  });

  it("Undelegate All (cleanup)", async () => {
    const tx = await program.methods
      .undelegateAll()
      .accountsPartial({
        payer: player1.publicKey,
        game: gamePda,
        player1Choice: player1ChoicePda,
        player2Choice: player2ChoicePda,
      })
      .transaction();
    sendSvmTx(svm, [player1], tx, "ephemeral", "undelegate all");
    console.log(`🧹 All three PDAs committed + undelegated`);
  });

  it("Claim Pot (winner takes the stake)", async () => {
    const info = svm.getAccountFor(gamePda, { target: "base" });
    if (
      !info.exists ||
      info.programAddress.toString() !== programId.toString()
    ) {
      throw new Error("❌ Game never came back to the base layer");
    }

    const game = program.coder.accounts.decode("game", Buffer.from(info.data));
    const vaultBefore = svm.getBalance(vaultPda);
    console.log(
      `🏦 Vault holds ${Number(vaultBefore ?? 0n) / 1_000_000_000} SOL (pot)`,
    );

    const winner =
      "winner" in game.roundResult
        ? (game.roundResult.winner["0"] as PublicKey)
        : null;
    const recipient = winner ?? player1.publicKey;
    const balBefore = svm.getBalance(recipient) ?? 0n;

    const tx = await program.methods
      .claimPot()
      .accountsPartial({
        game: gamePda,
        vault: vaultPda,
        player1: player1.publicKey,
        player2: player2.publicKey,
        payer: player1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    sendSvmTx(svm, [player1], tx, "base", "claim pot");
    console.log("💰 Pot claimed");

    const vaultAfter = svm.getBalance(vaultPda) ?? 0n;
    const balAfter = svm.getBalance(recipient) ?? 0n;
    const settledInfo = svm.getAccountFor(gamePda, { target: "base" });
    if (!settledInfo.exists) {
      throw new Error("❌ Game missing after claim");
    }
    const settled = program.coder.accounts.decode(
      "game",
      Buffer.from(settledInfo.data),
    );

    if (vaultAfter !== 0n) throw new Error("❌ Vault not fully drained");
    if (!settled.paid) throw new Error("❌ Game not marked paid");
    if (winner) {
      const gained = balAfter - balBefore;
      console.log(
        `🏆 Winner net change: ${Number(gained) / 1_000_000_000} SOL`,
      );
      if (gained <= 0n) throw new Error("❌ Winner did not receive the pot");
    }
    console.log("✅ Pot paid out and game settled");
  });
});

const choiceEmoji: Record<string, string> = {
  rock: "🪨 Rock",
  paper: "📄 Paper",
  scissors: "✂️  Scissors",
};

function fmtChoice(c: unknown): string {
  if (!c || typeof c !== "object") return "—";
  const key = Object.keys(c)[0];
  return choiceEmoji[key] ?? key;
}

function fmtResult(result: unknown, p1: PublicKey, p2: PublicKey): string {
  if (!result || typeof result !== "object") return "—";
  if ("tie" in result) return "🤝 Tie";
  if ("none" in result) return "⏳ Not yet revealed";
  if ("winner" in result) {
    const winnerResult = result.winner;
    if (!winnerResult || typeof winnerResult !== "object") return "—";
    const winner = (winnerResult as Record<string, PublicKey>)["0"];
    const label = winner.equals(p1)
      ? "Player 1"
      : winner.equals(p2)
        ? "Player 2"
        : "Unknown";
    return `🏆 ${label} (${winner.toBase58()})`;
  }
  return JSON.stringify(result);
}

function printGameResult(game: {
  gameId: { toString(): string };
  player1: PublicKey;
  player2: PublicKey;
  player1Choice: unknown;
  player2Choice: unknown;
  roundResult: unknown;
}) {
  const p1 = game.player1;
  const p2 = game.player2;
  console.log("┌─────────────────────────────────────────────");
  console.log(`│ 🎲  Game #${game.gameId.toString()}`);
  console.log(
    `│ 👤  Player 1: ${p1.toBase58()}  →  ${fmtChoice(game.player1Choice)}`,
  );
  console.log(
    `│ 👤  Player 2: ${p2.toBase58()}  →  ${fmtChoice(game.player2Choice)}`,
  );
  console.log(`│ Result:  ${fmtResult(game.roundResult, p1, p2)}`);
  console.log("└─────────────────────────────────────────────");
}
