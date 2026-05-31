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
          process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app/",
          {
            wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet.magicblock.app/",
            commitment: "confirmed",
          }
      ),
      anchor.Wallet.local()
  );
  const ephemeralProgram = new Program<RandomDiceDelegated>(program.idl, providerEphemeralRollup);

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
    const tx = await program.methods
      .initialize()
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("Your transaction signature", tx);
  });

  it("Delegate Roll Dice!", async () => {
    // Validator identity for delegation: VALIDATOR env var wins; otherwise default to
    // local-ER validator iff the ER endpoint is localhost.
    const isLocal =
      providerEphemeralRollup.connection.rpcEndpoint.includes("localhost") ||
      providerEphemeralRollup.connection.rpcEndpoint.includes("127.0.0.1");
    const validatorPubkey = process.env.VALIDATOR
      ? new PublicKey(process.env.VALIDATOR)
      : isLocal
      ? new PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev")
      : null;
    const remainingAccounts = validatorPubkey
      ? [{ pubkey: validatorPubkey, isSigner: false, isWritable: false }]
      : [];
    const tx = await program.methods
      .delegate()
      .accounts({
        user: anchor.Wallet.local().publicKey,
      })
      .remainingAccounts(remainingAccounts)
      .rpc({ commitment: "confirmed" });
    console.log("Your transaction signature", tx);
  });

  it("Do Roll Dice Delegated!", async () => {
    const before = await ephemeralProgram.account.player
      .fetchNullable(playerPda)
      .catch(() => null);
    const tx = await ephemeralProgram.methods
      .rollDiceDelegated(0)
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("rollDiceDelegated tx:", tx);

    // Wait for the VRF callback to land on the ER and rewrite the player state.
    const start = Date.now();
    let player = await ephemeralProgram.account.player.fetch(playerPda, "processed");
    while (Date.now() - start < 10_000) {
      player = await ephemeralProgram.account.player.fetch(playerPda, "processed");
      if (!before || JSON.stringify(player) !== JSON.stringify(before)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log(`player (ER, after ${Date.now() - start}ms):`, player);
  });

  it("Undelegate Roll Dice!", async () => {
    const tx = await ephemeralProgram.methods
      .undelegate()
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("Your transaction signature", tx);
  });

});
