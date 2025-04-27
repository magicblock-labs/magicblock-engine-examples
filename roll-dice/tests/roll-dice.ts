import * as anchor from "@coral-xyz/anchor";
import {Program, web3} from "@coral-xyz/anchor";
import { RandomDice } from "../target/types/random_dice";

describe("roll-dice", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.RandomDice as Program<RandomDice>;

  it("Initialized player!", async () => {
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });

  it("Do Roll Dice!", async () => {
    const tx = await program.methods.rollDice(0).rpc();
    console.log("Your transaction signature", tx);
    const playerPk = web3.PublicKey.findProgramAddressSync([Buffer.from("playerd"), anchor.getProvider().publicKey.toBytes()], program.programId)[0];
    let player =  await program.account.player.fetch(playerPk, "processed");
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log("Player PDA: ", playerPk.toBase58());
    console.log("player: ", player);
  });

});
