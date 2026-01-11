import * as anchor from "@coral-xyz/anchor";
import { sendAndConfirmTransaction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { AnchorRockPaperScissor } from "../target/types/anchor_rock_paper_scissor";
import BN from "bn.js";
import * as nacl from 'tweetnacl';

import {
  permissionPdaFromAccount,
  getAuthToken,
  getPermissionStatus,
  waitUntilPermissionActive,
  GetCommitmentSignature,
  MEMBER_FLAG_AUTHORITY,
  Member,
  createDelegatePermissionInstruction,
  MEMBER_FLAG_TX_LOGS
} from "@magicblock-labs/ephemeral-rollups-sdk";


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

  const teeUrl = "https://tee.magicblock.app"
  const teeWsUrl = "wss://tee.magicblock.app"
  const ephemeralRpcEndpoint = (process.env.EPHEMERAL_PROVIDER_ENDPOINT || teeUrl).replace(/\/$/, "");
  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      ephemeralRpcEndpoint,
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT || teeWsUrl,
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

  const permissionForGame = permissionPdaFromAccount(gamePda);
  const permissionForPlayer1Choice = permissionPdaFromAccount(player1ChoicePda);
  const permissionForPlayer2Choice = permissionPdaFromAccount(player2ChoicePda);

  console.log("Game PDA:", gamePda.toBase58());
  console.log("Player1:", player1.publicKey.toBase58());
  console.log("Player1 Choice PDA:", player1ChoicePda.toBase58());
  console.log("Player2:", player2.publicKey.toBase58());
  console.log("Player2Choice PDA:", player2ChoicePda.toBase58());
  console.log("Permission PDA for Game:", permissionForGame.toString());
  console.log("Permission PDA for Player1 Choice:", permissionForPlayer1Choice.toString());
  console.log("Permission PDA for Player2 Choice:", permissionForPlayer2Choice.toString());



  // Permission TEE AuthToken
  let authTokenPlayer1: { token: string; expiresAt: number };
  let authTokenPlayer2: { token: string; expiresAt: number };
  let providerTeePlayer1
  let providerTeePlayer2

  it("Airdrop SOL to Player 2", async () => {
      const tx = new anchor.web3.Transaction().add(
              anchor.web3.SystemProgram.transfer({
              fromPubkey: player1.publicKey,
              toPubkey: player2.publicKey,
              lamports: 0.05 * anchor.web3.LAMPORTS_PER_SOL, // send 0.05 SOL
              })
          );

      await provider.sendAndConfirm(tx, [player1]); // player1 is wallet
      const balance1 = await provider.connection.getBalance(player1.publicKey)
      const balance2 = await provider.connection.getBalance(player2.publicKey);
      console.log("💸 Player 1 Balance:", balance1 / anchor.web3.LAMPORTS_PER_SOL, "SOL");
      console.log("💸 Player 2 Balance:", balance2 / anchor.web3.LAMPORTS_PER_SOL, "SOL");

      // Get Auth Tokens if using TEE
        if (ephemeralRpcEndpoint.includes("tee")) {
            authTokenPlayer1 = await getAuthToken(ephemeralRpcEndpoint, player1.publicKey, (message: Uint8Array) => Promise.resolve(nacl.sign.detached(message, player1.secretKey)));
            console.log("Player 1 Explorer URL:", `https://solscan.io/?cluster=custom&customUrl=${teeUrl}?token=${authTokenPlayer1.token}`);
            authTokenPlayer2 = await getAuthToken(ephemeralRpcEndpoint, player2.publicKey, (message: Uint8Array) => Promise.resolve(nacl.sign.detached(message, player2.secretKey)));
            console.log("Player 2 Explorer URL:", `https://solscan.io/?cluster=custom&customUrl=${teeUrl}?token=${authTokenPlayer2.token}`);
          providerTeePlayer1 = new anchor.AnchorProvider(
            new anchor.web3.Connection(
              process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
                `${teeUrl}?token=${authTokenPlayer1.token}`,
              {
                wsEndpoint:
                  process.env.EPHEMERAL_WS_ENDPOINT || `${teeWsUrl}?token=${authTokenPlayer1.token}`,
              },
            ),
            anchor.Wallet.local(),
          );
          providerTeePlayer2 = new anchor.AnchorProvider(
            new anchor.web3.Connection(
              process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
                `${teeUrl}?token=${authTokenPlayer2.token}`,
              {
                wsEndpoint:
                  process.env.EPHEMERAL_WS_ENDPOINT || `${teeWsUrl}?token=${authTokenPlayer2.token}`,
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

    // Create and delegate permission for game account
    const permissionForGame = permissionPdaFromAccount(gamePda);
    let membersForGame : Member[] | null = [ 
      {
        flags: MEMBER_FLAG_AUTHORITY | MEMBER_FLAG_TX_LOGS,
        pubkey: player1.publicKey
      },
      {
        flags: MEMBER_FLAG_AUTHORITY | MEMBER_FLAG_TX_LOGS,
        pubkey: player2.publicKey
      }
    ]
    const createGamePermissionIx = await program.methods
      .createPermission(
        { game: { gameId } },
        membersForGame 
      )
      .accountsPartial({
        payer: player1.publicKey,
        permissionedAccount: gamePda,
        permission: permissionForGame,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();
    
    const delegatePermissionGame = createDelegatePermissionInstruction({
      payer: player1.publicKey,
      validator: ER_VALIDATOR,
      permissionedAccount: gamePda,
    })
    

    // Create permission group and permission for player choice account
    let members : Member[] | null = [ 
      {
        flags: MEMBER_FLAG_AUTHORITY | MEMBER_FLAG_TX_LOGS,
        pubkey: player1.publicKey
      }
    ]
    const createPlayer1ChoicePermissionIx = await program.methods
      .createPermission(
        { playerChoice: { gameId, player: player1.publicKey } },
        members
      )
      .accountsPartial({
        payer: player1.publicKey,
        permissionedAccount: player1ChoicePda,
        permission: permissionForPlayer1Choice,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();
    const delegatePermission1 = createDelegatePermissionInstruction({
      payer: player1.publicKey,
      validator: ER_VALIDATOR,
      permissionedAccount: player1ChoicePda,
    })

    const delegatePlayerChoice1Ix = await program.methods
        .delegatePda({ playerChoice: { gameId, player: player1.publicKey } })
        .accounts({
            payer: player1.publicKey,
            validator: ER_VALIDATOR,
            pda: player1ChoicePda,
        })
        .instruction();

    let tx = new anchor.web3.Transaction().add(
      createGameIx,
      createGamePermissionIx,
      delegatePermissionGame,
      createPlayer1ChoicePermissionIx,
      delegatePermission1,
      delegatePlayerChoice1Ix
    );
    tx.feePayer = provider.wallet.publicKey;
    const txHash = await sendAndConfirmTransaction(provider.connection, tx, [provider.wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log("✅ Game Created:", txHash);

    const result = await waitUntilPermissionActive(ephemeralRpcEndpoint, player1ChoicePda);
    if (result) {
      console.log("✅ Player 1 Choice permission active:", player1ChoicePda.toBase58(), txHash);
    } else {
      console.log("❌ Player 1 Choice permission not active:", player1ChoicePda.toBase58());
    }
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
    let members : Member[] | null = [ 
      {
        flags: MEMBER_FLAG_AUTHORITY | MEMBER_FLAG_TX_LOGS,
        pubkey: player2.publicKey
      }
    ]
    const createPlayer2ChoicePermissionIx = await program.methods
      .createPermission(
        { playerChoice: { gameId, player: player2.publicKey } },
        members
      )
      .accountsPartial({
        payer: player2.publicKey,
        permissionedAccount: player2ChoicePda,
        permission: permissionForPlayer2Choice,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    const delegatePermission2 = createDelegatePermissionInstruction({
      payer: player2.publicKey,
      validator: ER_VALIDATOR,
      permissionedAccount: player2ChoicePda,
    })
    
    const delegateGameIx = await program.methods
        .delegatePda({ game: { gameId } })
        .accounts({
            payer: player2.publicKey,
            validator: ER_VALIDATOR,
            pda: gamePda,
        })
        .instruction()

    const delegatePlayerChoice2Ix = await program.methods
        .delegatePda({ playerChoice: { gameId, player: player2.publicKey } })
        .accounts({
            payer: player2.publicKey,
            validator: ER_VALIDATOR,
            pda: player2ChoicePda,
        })
        .instruction()

    let tx = new anchor.web3.Transaction().add(
        joinGameIx,
        createPlayer2ChoicePermissionIx,
        delegatePermission2,
        delegateGameIx,
        delegatePlayerChoice2Ix
    );

    tx.feePayer = player2.publicKey;
    const txHash = await sendAndConfirmTransaction(provider.connection, tx, [player2], {
      skipPreflight: true,
      commitment: "confirmed",
    });

    console.log(`✅ Player 2 joined game ${gameId}: ${txHash}`);

    const player2ChoiceResult = await waitUntilPermissionActive(ephemeralRpcEndpoint, player2ChoicePda);
    if (player2ChoiceResult) {
      console.log("✅ Player 2 Choice permission active:", player2ChoicePda.toBase58(), txHash);
    } else {
      console.log("❌ Player 2 Choice permission not active:", player2ChoicePda.toBase58());
    }
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
      await providerTeePlayer1.connection.getLatestBlockhash())
    .blockhash;
    const txHash = await sendAndConfirmTransaction(providerTeePlayer1.connection, tx, [player1], {
      skipPreflight: true,
      commitment: "confirmed",
    });

    console.log(`✅ Player 1 ${player1.publicKey} chose ${JSON.stringify(choice)}: ${txHash}`);
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
    const txHash = await sendAndConfirmTransaction(providerTeePlayer2.connection, tx, [player2], {
      skipPreflight: true,
      commitment: "confirmed",
    });

    console.log(`✅ Player 2 ${player2.publicKey} chose ${JSON.stringify(choice)}: ${txHash}`);
  });

  it("Player 1 checks own choice", async () => {
    const accountInfo = await providerTeePlayer1.connection.getAccountInfo(player1ChoicePda);
    const player1ChoiceData = accountInfo.data;
    const player1ChoiceAccount = program.account.playerChoice.coder.accounts.decode("playerChoice", player1ChoiceData);
    console.log(`👀 Check Player 1 own Choice:`, player1ChoiceAccount.choice);
  });

    it("Player 2 check own choice", async () => {
    const accountInfo = await providerTeePlayer2.connection.getAccountInfo(player2ChoicePda);
    const player2ChoiceData = accountInfo.data;
    const player2ChoiceAccount = program.account.playerChoice.coder.accounts.decode("playerChoice", player2ChoiceData);
    console.log(`👀 Check Player 2 own Choice:`, player2ChoiceAccount.choice);
  });

  it("Sneak Player 1 Choice"  , async () => {
    await getPermissionStatus(ephemeralRpcEndpoint, player1ChoicePda)
    const accountInfo = await providerTeePlayer2.connection.getAccountInfo(player1ChoicePda);
    if (accountInfo === null) {
      console.log(`✅ Player 1 choice account not found — as expected.`);
      return; // test passes
    }
    // You can optionally fail if account *shouldn't* exist:
    throw new Error("❌ Player 1 choice account exists unexpectedly!");
  });

  it("Sneak Player 2 Choice"  , async () => {
    await getPermissionStatus(ephemeralRpcEndpoint, player2ChoicePda)
    const accountInfo = await providerTeePlayer1.connection.getAccountInfo(player2ChoicePda);
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
        permissionGame: permissionForGame,
        permission1: permissionForPlayer1Choice,
        permission2: permissionForPlayer2Choice,
        payer: player1.publicKey,
      })
      .transaction();
    tx.feePayer = player1.publicKey;
    const txHash = await sendAndConfirmTransaction(providerTeePlayer1.connection, tx, [player1], {
      skipPreflight: true,
      commitment: "confirmed"
    });
    console.log("✅ Reveal Winner TX Sent:", txHash);
    // const txBase = await GetCommitmentSignature(txHash, providerTeePlayer1.connection)
    // console.log("✅ Winner Revealed:", txBase)

    const accountInfo = await providerTeePlayer1.connection.getAccountInfo(gamePda);
    const gameAccount = program.coder.accounts.decode("game", accountInfo.data);
    
    if (gameAccount.result?.winner) {
      console.log("🏆 Winner is:", gameAccount.result.winner.toBase58());
    } else if (gameAccount.result) {
      console.log("🏆 Result: Tie");
    } else {
      console.log("🏆 Result: Game not revealed");
    }

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