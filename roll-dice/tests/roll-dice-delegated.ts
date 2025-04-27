import * as anchor from "@coral-xyz/anchor";
import {Program} from "@coral-xyz/anchor";
import { RandomDiceDelegated } from "../target/types/random_dice_delegated";

describe.only("roll-dice-delegated", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.RandomDiceDelegated as Program<RandomDiceDelegated>;

  const providerEphemeralRollup = new anchor.AnchorProvider(
      new anchor.web3.Connection(
          process.env.PROVIDER_ENDPOINT || "https://devnet.magicblock.app/",
          {
            wsEndpoint: process.env.WS_ENDPOINT || "wss://devnet.magicblock.app/",
          }
      ),
      anchor.Wallet.local()
  );
  const ephemeralProgram = new Program(program.idl, providerEphemeralRollup);

  it.skip("Initialized player!", async () => {
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });

  it.skip("Delegate Roll Dice!", async () => {
    const tx = await program.methods.delegate().rpc();
    console.log("Your transaction signature", tx);
  });

  it("Do Roll Dice Delegated!", async () => {
    const tx = await ephemeralProgram.methods.rollDiceDelegated(0).rpc();
    console.log("Your transaction signature", tx);
  });

});
