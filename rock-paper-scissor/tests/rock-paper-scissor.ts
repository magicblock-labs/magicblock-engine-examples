import * as anchor from "@coral-xyz/anchor";
import { sendAndConfirmTransaction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { AnchorRockPaperScissor } from "../target/types/anchor_rock_paper_scissor";
import BN from "bn.js";
import * as nacl from "tweetnacl";

import {
  permissionPdaFromAccount,
  getAuthToken,
  getPermissionStatus,
  waitUntilPermissionActive,
  AUTHORITY_FLAG,
  Member,
  TX_LOGS_FLAG,
  PERMISSION_PROGRAM_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const VAULT_ID = new anchor.web3.PublicKey(
  "MagicVau1t999999999999999999999999999999999",
);

describe("anchor-rock-paper-scissor", () => {
  // Configure the client
  let provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  let program = anchor.workspace
    .AnchorRockPaperScissor as Program<AnchorRockPaperScissor>;
  console.log("Program ID: ", program.programId.toString());

  const ER_VALIDATOR = new anchor.web3.PublicKey(
    process.env.VALIDATOR || "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
  ); // TEE ER Validator
  const player1 = provider.wallet.payer;
  const player2 = anchor.web3.Keypair.generate();

  const teeUrl =
    process.env.TEE_PROVIDER_ENDPOINT || "https://tee.magicblock.app";
  const teeWsUrl = process.env.TEE_WS_ENDPOINT || "wss://tee.magicblock.app";
  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(teeUrl, {
      wsEndpoint: teeWsUrl,
    }),
    anchor.Wallet.local(),
  );
  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    providerEphemeralRollup.connection.rpcEndpoint,
  );

  // Random game ID (u64)
  const gameId = new BN(Date.now());
  console.log("Game ID (u64):", gameId.toString());

  // PDA seeds
  const GAME_SEED = Buffer.from("game");
  const PLAYER_CHOICE_SEED = Buffer.from("player_choice");

  // Derived PDAs
  let [gamePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [GAME_SEED, gameId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  let [player1ChoicePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      PLAYER_CHOICE_SEED,
      gameId.toArrayLike(Buffer, "le", 8),
      player1.publicKey.toBuffer(),
    ],
    program.programId,
  );
  let [player2ChoicePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      PLAYER_CHOICE_SEED,
      gameId.toArrayLike(Buffer, "le", 8),
      player2.publicKey.toBuffer(),
    ],
    program.programId,
  );

  const permissionForGame = permissionPdaFromAccount(gamePda);
  const permissionForPlayer1Choice = permissionPdaFromAccount(player1ChoicePda);
  const permissionForPlayer2Choice = permissionPdaFromAccount(player2ChoicePda);

  console.log("Game PDA:", gamePda.toBase58());
  console.log("Player1:", player1.publicKey.toBase58());
  console.log("Player1 Choice PDA:", player1ChoicePda.toBase58());
  console.log("Player2:", player2.publicKey.toBase58());
  console.log("Player2Choice PDA:", player2ChoicePda.toBase58());
  console.log("Permission PDA for Game:", permissionForGame.toString());
  console.log(
    "Permission PDA for Player1 Choice:",
    permissionForPlayer1Choice.toString(),
  );
  console.log(
    "Permission PDA for Player2 Choice:",
    permissionForPlayer2Choice.toString(),
  );

  // Helper: wait for a delegated PDA to land on the ER before sending init_permission.
  const waitUntilOnEr = async (
    connection: anchor.web3.Connection,
    pda: anchor.web3.PublicKey,
    label: string,
  ) => {
    for (let i = 0; i < 20; i++) {
      const info = await connection.getAccountInfo(pda);
      if (info) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.warn(`⚠️  ${label} not seen on ER after 10s`);
  };

  // Permission TEE AuthToken
  let authTokenPlayer1: { token: string; expiresAt: number };
  let authTokenPlayer2: { token: string; expiresAt: number };
  let providerTeePlayer1: anchor.AnchorProvider;
  let providerTeePlayer2: anchor.AnchorProvider;

  it("Airdrop SOL to Player 2", async () => {
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: player1.publicKey,
        toPubkey: player2.publicKey,
        lamports: 0.05 * anchor.web3.LAMPORTS_PER_SOL, // send 0.05 SOL
      }),
    );

    await provider.sendAndConfirm(tx, [player1]); // player1 is wallet
    const balance1 = await provider.connection.getBalance(player1.publicKey);
    const balance2 = await provider.connection.getBalance(player2.publicKey);
    console.log(
      "💸 Player 1 Balance:",
      balance1 / anchor.web3.LAMPORTS_PER_SOL,
      "SOL",
    );
    console.log(
      "💸 Player 2 Balance:",
      balance2 / anchor.web3.LAMPORTS_PER_SOL,
      "SOL",
    );

    // Get Auth Tokens if using TEE
    authTokenPlayer1 = await getAuthToken(
      teeUrl,
      player1.publicKey,
      (message: Uint8Array) =>
        Promise.resolve(nacl.sign.detached(message, player1.secretKey)),
    );
    console.log(
      "Player 1 Explorer URL:",
      `https://solscan.io/?cluster=custom&customUrl=${teeUrl}?token=${authTokenPlayer1.token}`,
    );
    authTokenPlayer2 = await getAuthToken(
      teeUrl,
      player2.publicKey,
      (message: Uint8Array) =>
        Promise.resolve(nacl.sign.detached(message, player2.secretKey)),
    );
    console.log(
      "Player 2 Explorer URL:",
      `https://solscan.io/?cluster=custom&customUrl=${teeUrl}?token=${authTokenPlayer2.token}`,
    );
    // Always append ?token=… — EPHEMERAL_PROVIDER_ENDPOINT (set by CI /
    // test-locally.sh) is the bare TEE base URL, not a pre-tokenized URL.
    const teeBase = teeUrl.replace(/\/$/, "");
    const teeWsBase = teeWsUrl.replace(/\/$/, "");
    providerTeePlayer1 = new anchor.AnchorProvider(
      new anchor.web3.Connection(`${teeBase}?token=${authTokenPlayer1.token}`, {
        wsEndpoint: `${teeWsBase}?token=${authTokenPlayer1.token}`,
      }),
      anchor.Wallet.local(),
    );
    providerTeePlayer2 = new anchor.AnchorProvider(
      new anchor.web3.Connection(`${teeBase}?token=${authTokenPlayer2.token}`, {
        wsEndpoint: `${teeWsBase}?token=${authTokenPlayer2.token}`,
      }),
      anchor.Wallet.local(),
    );
  });

  it("Create Game by Player 1 (base: create + delegate p1_choice)", async () => {
    // create_game pre-funds the game + p1_choice PDAs with ephemeral permission
    // rent. We delegate p1_choice now, but the game stays on base until player 2
    // joins — join_game needs the game to still be owned by our program.
    const createGameIx = await program.methods
      .createGame(gameId)
      .accounts({
        //@ts-ignore
        game: gamePda,
        playerChoice: player1ChoicePda,
        player1: player1.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const delegatePlayer1ChoiceIx = await program.methods
      .delegatePda({ playerChoice: { gameId, player: player1.publicKey } })
      .accounts({
        payer: player1.publicKey,
        validator: ER_VALIDATOR,
        pda: player1ChoicePda,
      })
      .instruction();

    const tx = new anchor.web3.Transaction().add(
      createGameIx,
      delegatePlayer1ChoiceIx,
    );
    tx.feePayer = provider.wallet.publicKey;
    const txHash = await sendAndConfirmTransaction(
      provider.connection,
      tx,
      [provider.wallet.payer],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    console.log("✅ Game Created + P1 Choice Delegated:", txHash);
  });

  it("Init ephemeral permission for Player 1 Choice (ER)", async () => {
    await waitUntilOnEr(
      providerTeePlayer1.connection,
      player1ChoicePda,
      "player1_choice",
    );

    // Player 1 Choice permission: private to [p1] only — p2 can't sneak a peek
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
        ephemeralVault: VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .instruction();

    const tx = new anchor.web3.Transaction().add(initP1ChoicePermissionIx);
    tx.feePayer = player1.publicKey;
    tx.recentBlockhash = (
      await providerTeePlayer1.connection.getLatestBlockhash()
    ).blockhash;
    const txHash = await sendAndConfirmTransaction(
      providerTeePlayer1.connection,
      tx,
      [player1],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    console.log("✅ P1 Choice permission initialized:", txHash);

    const p1Result = await waitUntilPermissionActive(teeUrl, player1ChoicePda);
    console.log(
      p1Result
        ? "✅ Player 1 Choice permission active"
        : "❌ Player 1 Choice permission not active",
    );
  });

  it("Join Game (Player 2) — base: join + delegate game + delegate p2_choice", async () => {
    const joinGameIx = await program.methods
      .joinGame(gameId)
      .accounts({
        //@ts-ignore
        game: gamePda,
        playerChoice: player2ChoicePda,
        player: player2.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    // Now that both players are recorded on the game, delegate the game itself.
    const delegateGameIx = await program.methods
      .delegatePda({ game: { gameId } })
      .accounts({
        payer: player2.publicKey,
        validator: ER_VALIDATOR,
        pda: gamePda,
      })
      .instruction();

    const delegatePlayer2ChoiceIx = await program.methods
      .delegatePda({ playerChoice: { gameId, player: player2.publicKey } })
      .accounts({
        payer: player2.publicKey,
        validator: ER_VALIDATOR,
        pda: player2ChoicePda,
      })
      .instruction();

    const tx = new anchor.web3.Transaction().add(
      joinGameIx,
      delegateGameIx,
      delegatePlayer2ChoiceIx,
    );
    tx.feePayer = player2.publicKey;
    const txHash = await sendAndConfirmTransaction(
      provider.connection,
      tx,
      [player2],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    console.log(
      `✅ Player 2 joined game ${gameId} + delegated game + p2 choice: ${txHash}`,
    );
  });

  it("Init ephemeral permissions for Game + Player 2 Choice (ER)", async () => {
    await waitUntilOnEr(providerTeePlayer2.connection, gamePda, "game");
    await waitUntilOnEr(
      providerTeePlayer2.connection,
      player2ChoicePda,
      "player2_choice",
    );

    // Game permission: private to [p1, p2] (both can see game state during play)
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
        ephemeralVault: VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .instruction();

    // Player 2 Choice permission: private to [p2] only — p1 can't sneak a peek
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
        ephemeralVault: VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .instruction();

    const tx = new anchor.web3.Transaction().add(
      initGamePermissionIx,
      initP2ChoicePermissionIx,
    );
    tx.feePayer = player2.publicKey;
    tx.recentBlockhash = (
      await providerTeePlayer2.connection.getLatestBlockhash()
    ).blockhash;
    const txHash = await sendAndConfirmTransaction(
      providerTeePlayer2.connection,
      tx,
      [player2],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    console.log(`✅ Game + P2 Choice permissions initialized: ${txHash}`);

    const result = await waitUntilPermissionActive(teeUrl, player2ChoicePda);
    console.log(
      result
        ? "✅ Player 2 Choice permission active"
        : "❌ Player 2 Choice permission not active",
    );
  });

  it("Player 1 Makes Choice", async () => {
    const choice = getRandomChoice();
    const makeChoice1Ix = await program.methods
      .makeChoice(gameId, choice)
      .accounts({
        // @ts-ignore
        playerChoice: player1ChoicePda,
        player: player1.publicKey,
      })
      .instruction();

    let tx = new anchor.web3.Transaction().add(makeChoice1Ix);

    tx.feePayer = player1.publicKey;
    tx.recentBlockhash = (
      await providerTeePlayer1.connection.getLatestBlockhash()
    ).blockhash;
    const txHash = await sendAndConfirmTransaction(
      providerTeePlayer1.connection,
      tx,
      [player1],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );

    console.log(
      `✅ Player 1 ${player1.publicKey} chose ${JSON.stringify(choice)}: ${txHash}`,
    );
  });

  it("Player 2 Makes Choice", async () => {
    const choice = getRandomChoice();
    const makeChoice2Ix = await program.methods
      .makeChoice(gameId, choice)
      .accounts({
        // @ts-ignore
        playerChoice: player2ChoicePda,
        player: player2.publicKey,
      })
      .instruction();

    let tx = new anchor.web3.Transaction().add(makeChoice2Ix);

    tx.feePayer = player2.publicKey;
    tx.recentBlockhash = (
      await providerTeePlayer2.connection.getLatestBlockhash()
    ).blockhash;
    const txHash = await sendAndConfirmTransaction(
      providerTeePlayer2.connection,
      tx,
      [player2],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );

    console.log(
      `✅ Player 2 ${player2.publicKey} chose ${JSON.stringify(choice)}: ${txHash}`,
    );
  });

  it("Player 1 checks own choice", async () => {
    const accountInfo =
      await providerTeePlayer1.connection.getAccountInfo(player1ChoicePda);
    const player1ChoiceData = accountInfo.data;
    const player1ChoiceAccount =
      program.account.playerChoice.coder.accounts.decode(
        "playerChoice",
        player1ChoiceData,
      );
    console.log(`👀 Check Player 1 own Choice:`, player1ChoiceAccount.choice);
  });

  it("Player 2 check own choice", async () => {
    const accountInfo =
      await providerTeePlayer2.connection.getAccountInfo(player2ChoicePda);
    const player2ChoiceData = accountInfo.data;
    const player2ChoiceAccount =
      program.account.playerChoice.coder.accounts.decode(
        "playerChoice",
        player2ChoiceData,
      );
    console.log(`👀 Check Player 2 own Choice:`, player2ChoiceAccount.choice);
  });

  it("Sneak Player 1 Choice", async () => {
    await getPermissionStatus(teeUrl, player1ChoicePda);
    const accountInfo =
      await providerTeePlayer2.connection.getAccountInfo(player1ChoicePda);
    if (accountInfo === null) {
      console.log(`✅ Player 1 choice account not found — as expected.`);
      return; // test passes
    }
    // You can optionally fail if account *shouldn't* exist:
    throw new Error("❌ Player 1 choice account exists unexpectedly!");
  });

  it("Sneak Player 2 Choice", async () => {
    await getPermissionStatus(teeUrl, player2ChoicePda);
    const accountInfo =
      await providerTeePlayer1.connection.getAccountInfo(player2ChoicePda);
    // Assert that accountInfo is null (account not found)
    if (accountInfo === null) {
      console.log("✅ Player 2 choice account not found — as expected.");
      return; // test passes
    }
    // You can optionally fail if account *shouldn't* exist:
    throw new Error("❌ Player 2 choice account exists unexpectedly!");
  });

  it("Reveal Winner", async () => {
    let tx = await program.methods
      .revealWinner()
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
        ephemeralVault: VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .transaction();
    tx.feePayer = player1.publicKey;
    const txHash = await sendAndConfirmTransaction(
      providerTeePlayer1.connection,
      tx,
      [player1],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    console.log("✅ Reveal Winner TX Sent:", txHash);
    // const txBase = await GetCommitmentSignature(txHash, providerTeePlayer1.connection)
    // console.log("✅ Winner Revealed:", txBase)

    const accountInfo =
      await providerTeePlayer1.connection.getAccountInfo(gamePda);
    const gameAccount = program.coder.accounts.decode("game", accountInfo.data);
    printGameResult(gameAccount);
  });

  // Cleanup: commit + undelegate game + both player_choices in a single ix so
  // all three PDAs return to the base layer atomically and the test cycle can
  // be repeated against a clean ER state.
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
    tx.feePayer = player1.publicKey;
    const txHash = await sendAndConfirmTransaction(
      providerTeePlayer1.connection,
      tx,
      [player1],
      {
        skipPreflight: true,
        commitment: "confirmed",
      },
    );
    console.log(`🧹 All three PDAs committed + undelegated: ${txHash}`);
  });
});

type Choice = { rock: {} } | { paper: {} } | { scissors: {} };

function getRandomChoice(): Choice {
  const random = Math.floor(Math.random() * 3);
  switch (random) {
    case 0:
      return { rock: {} };
    case 1:
      return { paper: {} };
    case 2:
      return { scissors: {} };
    default:
      throw new Error("Invalid random value");
  }
}

const choiceEmoji: Record<string, string> = {
  rock: "🪨 Rock",
  paper: "📄 Paper",
  scissors: "✂️  Scissors",
};

function fmtChoice(c: any): string {
  if (!c) return "—";
  const key = Object.keys(c)[0];
  return choiceEmoji[key] ?? key;
}

function fmtResult(
  result: any,
  p1: anchor.web3.PublicKey,
  p2: anchor.web3.PublicKey,
): string {
  if (!result) return "—";
  if ("tie" in result) return "🤝 Tie";
  if ("none" in result) return "⏳ Not yet revealed";
  if ("winner" in result) {
    const winner: anchor.web3.PublicKey = result.winner["0"];
    const label = winner.equals(p1)
      ? "Player 1"
      : winner.equals(p2)
        ? "Player 2"
        : "Unknown";
    return `🏆 ${label} (${winner.toBase58()})`;
  }
  return JSON.stringify(result);
}

function printGameResult(game: any) {
  const p1 = game.player1 as anchor.web3.PublicKey;
  const p2 = game.player2 as anchor.web3.PublicKey;
  console.log("┌─────────────────────────────────────────────");
  console.log(`│ 🎲  Game #${game.gameId.toString()}`);
  console.log(
    `│ 👤  Player 1: ${p1.toBase58()}  →  ${fmtChoice(game.player1Choice)}`,
  );
  console.log(
    `│ 👤  Player 2: ${p2.toBase58()}  →  ${fmtChoice(game.player2Choice)}`,
  );
  console.log(`│ Result:  ${fmtResult(game.result, p1, p2)}`);
  console.log("└─────────────────────────────────────────────");
}
