import * as anchor from "@coral-xyz/anchor";
import {Program} from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { RandomDiceDelegated } from "../target/types/random_dice_delegated";

describe("roll-dice-delegated", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

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

  const playerPda = PublicKey.findProgramAddressSync(
    [Buffer.from("playerd2"), anchor.Wallet.local().publicKey.toBytes()],
    program.programId
  )[0];

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log("Ephemeral Rollup Connection: ", providerEphemeralRollup.connection.rpcEndpoint);
  console.log(`Current SOL Public Key: ${anchor.Wallet.local().publicKey}`)
  console.log("Player PDA: ", playerPda.toString());

  before(async function () {
    const balance = await provider.connection.getBalance(anchor.Wallet.local().publicKey)
    console.log('Current balance is', balance / LAMPORTS_PER_SOL, ' SOL','\n')
  })

  it("Initialized player!", async () => {
    const tx = await program.methods.initialize().rpc({ skipPreflight: true });
    console.log("Your transaction signature", tx);
  });

  it("Delegate Roll Dice!", async () => {
    const tx = await program.methods.delegate({
      commitFrequencyMs: 30000,
      validator: new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"),
    }).rpc();
    console.log("Your transaction signature", tx);
  });

  it("Do Roll Dice Delegated!", async () => {
    const tx = await ephemeralProgram.methods.rollDiceDelegated(0).rpc({ skipPreflight: true });
    console.log("Your transaction signature", tx);
  });

  it("Undelegate Roll Dice!", async () => {
    const tx = await ephemeralProgram.methods.undelegate().rpc({ skipPreflight: true });
    console.log("Your transaction signature", tx);
  });

});
