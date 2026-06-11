import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { RandomDiceDelegated } from "../target/types/random_dice_delegated";

// Default to the canonical ephemeral queue; override with VRF_EPHEMERAL_QUEUE env var to point at a test queue.
const DEFAULT_EPHEMERAL_QUEUE = new PublicKey(
  process.env.VRF_EPHEMERAL_QUEUE ||
    "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
);

describe("roll-dice-delegated", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .RandomDiceDelegated as Program<RandomDiceDelegated>;

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://devnet.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet.magicblock.app/",
        commitment: "confirmed",
      },
    ),
    anchor.Wallet.local(),
  );
  const ephemeralProgram = new Program<RandomDiceDelegated>(
    program.idl,
    providerEphemeralRollup,
  );

  const playerPda = PublicKey.findProgramAddressSync(
    [Buffer.from("playerd2"), anchor.Wallet.local().publicKey.toBytes()],
    program.programId,
  )[0];

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    providerEphemeralRollup.connection.rpcEndpoint,
  );
  console.log(`Current SOL Public Key: ${anchor.Wallet.local().publicKey}`);
  console.log("Player PDA: ", playerPda.toString());
  // Annotate the queue source so a wrong queue is obvious from the test log
  // (devnet/mainnet should be the SDK default; local needs the test queue).
  console.log(
    `VRF Ephemeral Queue: ${DEFAULT_EPHEMERAL_QUEUE.toString()}` +
      `${
        process.env.VRF_EPHEMERAL_QUEUE
          ? " (from VRF_EPHEMERAL_QUEUE env)"
          : " (SDK default)"
      }`,
  );

  before(async function () {
    const balance = await provider.connection.getBalance(
      anchor.Wallet.local().publicKey,
    );
    console.log("Current balance is", balance / LAMPORTS_PER_SOL, " SOL", "\n");
  });

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
    // Generate the seed BEFORE subscribing so the handler closes over it.
    // The program logs "Callback for client_seed={n}" inside
    // callback_roll_dice_simple — we match on that exact substring.
    const clientSeed = Math.floor(Math.random() * 256);
    const seedTag = `client_seed=${clientSeed}`;
    // Pre-arm a one-shot promise that the onLogs handler resolves with the
    // matching signature. No polling — we just await it, racing a timeout.
    let resolveSig!: (sig: string) => void;
    const sigPromise = new Promise<string>((r) => {
      resolveSig = r;
    });
    const callbackSubId = providerEphemeralRollup.connection.onLogs(
      program.programId,
      (info) => {
        if (
          !info.err &&
          info.logs.some((l) => l.includes("CallbackRollDiceSimple")) &&
          info.logs.some((l) => l.includes(seedTag))
        ) {
          resolveSig(info.signature);
        }
      },
      "processed",
    );

    try {
      const tx = await ephemeralProgram.methods
        .rollDiceDelegated(clientSeed)
        .accounts({ oracleQueue: DEFAULT_EPHEMERAL_QUEUE })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      console.log(`client_seed: ${clientSeed}`);
      console.log("rollDiceDelegated tx:", tx);

      const start = Date.now();
      const sig = await Promise.race([
        sigPromise,
        new Promise<null>((r) => setTimeout(() => r(null), 1_000)),
      ]);
      if (sig) {
        console.log(
          `callbackRollDiceSimple tx: ${sig} (after ${Date.now() - start}ms)`,
        );
      } else {
        throw new Error(`callbackRollDiceSimple not observed within 1s.`);
      }

      const player = await ephemeralProgram.account.player.fetch(
        playerPda,
        "processed",
      );
      console.log("player:", player);
    } finally {
      await providerEphemeralRollup.connection.removeOnLogsListener(
        callbackSubId,
      );
    }
  });

  it("Undelegate Roll Dice!", async () => {
    const tx = await ephemeralProgram.methods
      .undelegate()
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("Your transaction signature", tx);
  });
});
