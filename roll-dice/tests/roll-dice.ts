import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { RandomDice } from "../target/types/random_dice";
import { PublicKey } from "@solana/web3.js";

const DEFAULT_BASE_QUEUE = new PublicKey(
  process.env.VRF_BASE_QUEUE || "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
);

describe("roll-dice", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const program = anchor.workspace.RandomDice as Program<RandomDice>;

  const playerPda = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("playerd"), provider.publicKey!.toBytes()],
    program.programId,
  )[0];

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(`Current SOL Public Key: ${provider.publicKey}`);
  console.log("Player PDA: ", playerPda.toString());

  it("Initialized player!", async () => {
    const tx = await program.methods
      .initialize()
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("Your transaction signature", tx);
  });

  it("Do Roll Dice!", async () => {
    // Generate the seed BEFORE subscribing so the handler closes over it.
    // The program logs "client_seed=N" inside callback_roll_dice — we match
    // on that exact substring to pin the callback to our specific request.
    const clientSeed = Math.floor(Math.random() * 256);
    const seedTag = `client_seed=${clientSeed}`;
    // Pre-arm a one-shot promise that the onLogs handler resolves with the
    // matching signature. No polling — we just await it, racing a timeout.
    let resolveSig!: (sig: string) => void;
    const sigPromise = new Promise<string>((r) => {
      resolveSig = r;
    });
    const callbackSubId = provider.connection.onLogs(
      program.programId,
      (info) => {
        if (
          !info.err &&
          info.logs.some((l) => l.includes("CallbackRollDice")) &&
          info.logs.some((l) => l.includes(seedTag))
        ) {
          resolveSig(info.signature);
        }
      },
      "confirmed",
    );

    try {
      const tx = await program.methods
        .rollDice(clientSeed)
        .accounts({
          oracleQueue: DEFAULT_BASE_QUEUE,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      console.log(`client_seed: ${clientSeed}`);
      console.log("rollDice tx:", tx);

      // Base-chain VRF response is slower than ER (~1-5s typical) so 10s timeout.
      const start = Date.now();
      const sig = await Promise.race([
        sigPromise,
        new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
      ]);
      if (sig) {
        console.log(
          `callbackRollDice tx: ${sig} (after ${Date.now() - start}ms)`,
        );
      } else {
        throw new Error(`callbackRollDice not observed within 10s.`);
      }

      const player = await program.account.player.fetch(playerPda, "processed");
      console.log("player:", player);
    } finally {
      await provider.connection.removeOnLogsListener(callbackSubId);
    }
  });
});
