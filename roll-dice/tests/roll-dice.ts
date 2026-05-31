import * as anchor from "@coral-xyz/anchor";
import {Program, web3} from "@coral-xyz/anchor";
import { RandomDice } from "../target/types/random_dice";

describe("roll-dice", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.RandomDice as Program<RandomDice>;

  const playerPda = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("playerd"), anchor.getProvider().publicKey!.toBytes()],
    program.programId,
  )[0];

  it("Initialized player!", async () => {
    const tx = await program.methods
      .initialize()
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("Your transaction signature", tx);
  });

  it("Do Roll Dice!", async () => {
    const before = await program.account.player.fetchNullable(playerPda).catch(() => null);
    const tx = await program.methods
      .rollDice(0)
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("rollDice tx:", tx);

    // VRF is asynchronous — the rollDice ix requests randomness; the oracle
    // callback writes the result back to the player PDA in a separate tx. Poll
    // up to ~10s until the player state actually changes.
    const start = Date.now();
    let player = await program.account.player.fetch(playerPda, "processed");
    while (Date.now() - start < 10_000) {
      player = await program.account.player.fetch(playerPda, "processed");
      if (!before || JSON.stringify(player) !== JSON.stringify(before)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log(`Player PDA: ${playerPda.toBase58()} (after ${Date.now() - start}ms)`);
    console.log("player:", player);
  });

});
