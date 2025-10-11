import * as anchor from "@coral-xyz/anchor";
import { sendAndConfirmTransaction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { AnchorRockPaperScissor } from "../target/types/anchor_rock_paper_scissor";
import BN from "bn.js";

import {
  groupPdaFromId,
  PERMISSION_PROGRAM_ID,
  permissionPdaFromAccount
} from "@magicblock-labs/ephemeral-rollups-sdk/privacy";
import { checkPermissionAccount, getAuthToken } from "./tee-getAuthToken";


describe("anchor-rock-paper-scissor", () => {
  // Configure the client
  let provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program = anchor.workspace
    .AnchorRockPaperScissor as Program<AnchorRockPaperScissor>;
  console.log("Program ID: ", program.programId.toString());


  const ER_VALIDATOR = new anchor.web3.PublicKey("FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA"); // TEE ER Validator
  const player1 = provider.wallet.payer;
  const player2 = anchor.web3.Keypair.generate();

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://tee.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT || "wss://tee.magicblock.app/",
      },
    ),
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
      program.programId
    );
  let [player1ChoicePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [PLAYER_CHOICE_SEED, gameId.toArrayLike(Buffer, "le", 8), player1.publicKey.toBuffer()],
      program.programId
    );
  let [player2ChoicePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [PLAYER_CHOICE_SEED, gameId.toArrayLike(Buffer, "le", 8), player2.publicKey.toBuffer()],
      program.programId
    );

    console.log("Game PDA:", gamePda.toBase58());
    console.log("Player1:", player1.publicKey.toBase58());
    console.log("Player1 Choice PDA:", player1ChoicePda.toBase58());
    console.log("Player2:", player2.publicKey.toBase58());
    console.log("Player2 Choice PDA:", player2ChoicePda.toBase58());


    // Permission TEE AuthToken
    let authTokenPlayer1: string = "";
    let authTokenPlayer2: string = "";
    let providerTeePlayer1
    let providerTeePlayer2

    it("Airdrop SOL to Player 2", async () => {
        const tx = new anchor.web3.Transaction().add(
                anchor.web3.SystemProgram.transfer({
                fromPubkey: player1.publicKey,
                toPubkey: player2.publicKey,
                lamports: 0.02 * anchor.web3.LAMPORTS_PER_SOL, // send 0.005 SOL
                })
            );

        await provider.sendAndConfirm(tx, [player1]); // player1 is wallet
        const balance1 = await provider.connection.getBalance(player1.publicKey)
        const balance2 = await provider.connection.getBalance(player2.publicKey);
        console.log("💸 Player 1 Balance:", balance1 / anchor.web3.LAMPORTS_PER_SOL, "SOL");
        console.log("💸 Player 2 Balance:", balance2 / anchor.web3.LAMPORTS_PER_SOL, "SOL");

        // Get Auth Tokens if using TEE
        if (providerEphemeralRollup.connection.rpcEndpoint.includes("tee")) {
            authTokenPlayer1 = await getAuthToken(providerEphemeralRollup.connection.rpcEndpoint, player1);
            console.log("Player 1 Auth Token:", authTokenPlayer1);
            authTokenPlayer2 = await getAuthToken(providerEphemeralRollup.connection.rpcEndpoint, player2);
            console.log("Player 2 Auth Token:", authTokenPlayer2);
            providerTeePlayer1 = new anchor.AnchorProvider(
              new anchor.web3.Connection(
                process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
                  "https://tee.magicblock.app?token=" + authTokenPlayer1,
                {
                  wsEndpoint:
                    process.env.EPHEMERAL_WS_ENDPOINT || "wss://tee.magicblock.app?token=" + authTokenPlayer1,
                },
              ),
              anchor.Wallet.local(),
            );
            providerTeePlayer2 = new anchor.AnchorProvider(
              new anchor.web3.Connection(
                process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
                  "https://tee.magicblock.app?token=" + authTokenPlayer2,
                {
                  wsEndpoint:
                    process.env.EPHEMERAL_WS_ENDPOINT || "wss://tee.magicblock.app?token=" + authTokenPlayer2,
                },
              ),
              anchor.Wallet.local(),
            );
        }
    });

  it("Create Game by Player 1", async () => {

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

    // Create permission group and permission for player choice account
    const permission = permissionPdaFromAccount(player1ChoicePda);
    console.log("P1 Choice Permission:", permission.toString());
    const id = anchor.web3.Keypair.generate().publicKey;
    const group = groupPdaFromId(id);
    console.log("P1 Choice Permission Group:", group.toString());
    const createPlayer1ChoicePermissionIx = await program.methods
        .createPermission(gameId, id)
        .accountsPartial({
          payer: player1.publicKey,
          user: player1.publicKey,
          permissionedPda: player1ChoicePda,
          permission,
          group,
          permissionProgram: PERMISSION_PROGRAM_ID,
        })
        .instruction();

    const delegatePlayerChoice1Ix = await program.methods
        .delegatePlayerChoice(gameId)
        .accounts({
            payer: player1.publicKey,
            validator: ER_VALIDATOR,
            pda: player1ChoicePda,
        })
        .instruction();

    let tx = new anchor.web3.Transaction().add(
      createGameIx,
      createPlayer1ChoicePermissionIx,
      delegatePlayerChoice1Ix
    );
    tx.feePayer = provider.wallet.publicKey;
    const txHash = await sendAndConfirmTransaction(provider.connection, tx, [provider.wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log("✅ Game Created:", txHash);
  });

  it("Join Game (Player 2)", async () => {

    const joinGameIx =  await program.methods
        .joinGame(gameId)
        .accounts({
            //@ts-ignore
            game: gamePda,
            playerChoice: player2ChoicePda,
            player: player2.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .instruction();

    // Create permission group and permission for player choice account
    const permission = permissionPdaFromAccount(player2ChoicePda);
    console.log("P2 Choice Permission:", permission.toString());
    const id = anchor.web3.Keypair.generate().publicKey;
    const group = groupPdaFromId(id);
    console.log("P2 Choice Permission Group:", group.toString());
    const createPlayer2ChoicePermissionIx = await program.methods
        .createPermission(gameId, id)
        .accountsPartial({
          payer: player2.publicKey,
          permission,
          permissionProgram: PERMISSION_PROGRAM_ID,
          permissionedPda: player2ChoicePda,
          group,
          user: player2.publicKey,
        })
        .instruction();
    
    const delegateGameIx = await program.methods
        .delegateGame(gameId)
        .accounts({
            payer: player2.publicKey,
            validator: ER_VALIDATOR,
            pda: gamePda,
        })
        .instruction()

    const delegatePlayerChoice2Ix = await program.methods
        .delegatePlayerChoice(gameId)
        .accounts({
            payer: player2.publicKey,
            validator: ER_VALIDATOR,
            pda: player2ChoicePda,
        }
        )
        .instruction()

    let tx = new anchor.web3.Transaction().add(
        joinGameIx,
        createPlayer2ChoicePermissionIx,
        delegateGameIx,
        delegatePlayerChoice2Ix
    );

    tx.feePayer = player2.publicKey;
    const txHash = await sendAndConfirmTransaction(provider.connection, tx, [player2], {
      skipPreflight: true,
      commitment: "confirmed",
    });

    console.log("✅ Player 2 joined:", txHash);
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

    let tx = new anchor.web3.Transaction().add(
      makeChoice1Ix
    );

    tx.feePayer = player1.publicKey;
    tx.recentBlockhash = (
      await (authTokenPlayer1 ? providerTeePlayer1 : provider).connection.getLatestBlockhash())
    .blockhash;
    const txHash = await sendAndConfirmTransaction((authTokenPlayer1 ? providerTeePlayer1 : provider).connection, tx, [player1], {
      skipPreflight: true,
      commitment: "confirmed",
    });

    console.log("✅ Player 1 made choice:", choice, txHash);
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

    let tx = new anchor.web3.Transaction().add(
      makeChoice2Ix
    );

    tx.feePayer = player2.publicKey;
    const txHash = await sendAndConfirmTransaction((authTokenPlayer2 ? providerTeePlayer2 : provider).connection, tx, [player2], {
      skipPreflight: true,
      commitment: "confirmed",
    });

    console.log("✅ Player 2 made choice:", choice,txHash);
  });

  it("Player 1 checks own choice", async () => {
    const accountInfo = await (authTokenPlayer1 ? providerTeePlayer1 : provider).connection.getAccountInfo(player1ChoicePda);
    const player1ChoiceData = accountInfo.data;
    const player1ChoiceAccount = program.account.playerChoice.coder.accounts.decode("playerChoice", player1ChoiceData);
    console.log("👀 Check Player 1 own Choice:", player1ChoiceAccount.choice);
  });

    it("Player 2 check own choice", async () => {
    const accountInfo = await (authTokenPlayer2 ? providerTeePlayer2 : provider).connection.getAccountInfo(player2ChoicePda);
    const player2ChoiceData = accountInfo.data;
    const player2ChoiceAccount = program.account.playerChoice.coder.accounts.decode("playerChoice", player2ChoiceData);
    console.log("👀 Check Player 2 own Choice:", player2ChoiceAccount.choice);
  });

  it("Sneak Player 1 Choice"  , async () => {
    await checkPermissionAccount(player1ChoicePda.toString())
    const accountInfo = await (authTokenPlayer2 ? providerTeePlayer2 : provider).connection.getAccountInfo(player1ChoicePda);
    if (accountInfo === null) {
      console.log("✅ Player 1 choice account not found — as expected.");
      return; // test passes
    }
    // You can optionally fail if account *shouldn't* exist:
    throw new Error("❌ Player 1 choice account exists unexpectedly!");
  });

  it("Sneak Player 2 Choice"  , async () => {
    await checkPermissionAccount(player2ChoicePda.toString())
    const accountInfo = await (authTokenPlayer1 ? providerTeePlayer1 : provider).connection.getAccountInfo(player2ChoicePda);
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
      .accounts({
        //@ts-ignore
        game: gamePda,
        player1Choice: player1ChoicePda,
        player2Choice: player2ChoicePda,
        payer: player1.publicKey,
      })
      .transaction();
    tx.feePayer = player1.publicKey;
    const txHash = await sendAndConfirmTransaction((authTokenPlayer1 ? providerTeePlayer1 : provider).connection, tx, [player1], {
      skipPreflight: true,
      commitment: "finalized"
    });
    console.log("✅ Winner Revealed:", txHash)

    const accountInfo = await (authTokenPlayer1 ? providerTeePlayer1 : provider).connection.getAccountInfo(gamePda);
    const gameData = accountInfo.data;
    const gameAccount = program.account.game.coder.accounts.decode("game", gameData);
    console.log("🏆 Winner is:", gameAccount.winner?.toBase58());

  })

});


type Choice = { rock: {}; } | { paper: {}; } | { scissors: {}; };

function getRandomChoice(): Choice {
  const random = Math.floor(Math.random() * 3);
  switch (random) {
    case 0: return { rock: {} };
    case 1: return { paper: {} };
    case 2: return { scissors: {} };
    default: throw new Error("Invalid random value");
  }
}