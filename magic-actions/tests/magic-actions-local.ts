import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { MagicActions } from "../target/types/magic_actions";
import {
  DELEGATION_PROGRAM_ID,
  createCloseEscrowInstruction,
  createTopUpEscrowInstruction,
  escrowPdaFromEscrowAuthority,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { Transaction } from "@solana/web3.js";

const COUNTER_SEED = "counter";
const SEED_LEADERBOARD = "leaderboard";

describe("magic-actions-local", () => {
  // Base layer
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.PROVIDER_ENDPOINT || "http://localhost:8899",
      {
        wsEndpoint: process.env.WS_ENDPOINT || undefined,
        commitment: "confirmed",
      },
    ),
    anchor.Wallet.local(),
  );
  anchor.setProvider(provider);

  // ER
  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT || "http://localhost:7799",
      {
        wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || undefined,
        commitment: "confirmed",
      },
    ),
    anchor.Wallet.local(),
  );

  const program = anchor.workspace.magicActions as Program<MagicActions>;
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId,
  );
  const [leaderboardPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_LEADERBOARD)],
    program.programId,
  );

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log("Ephemeral Rollup Connection: ", providerEphemeralRollup.connection.rpcEndpoint);
  console.log("Program ID: ", program.programId.toBase58());
  console.log("Counter PDA: ", pda.toBase58());
  console.log("Leaderboard PDA: ", leaderboardPda.toBase58());

  async function printCounter(message: string) {
    const counterInfo = await provider.connection.getAccountInfo(pda);
    const isDelegated = counterInfo?.owner.toBase58() === DELEGATION_PROGRAM_ID.toBase58();
    const leaderboardAccount = await program.account.leaderboard.fetch(leaderboardPda);

    let counterBase = "<n/a>";
    let counterER = "<n/a>";
    if (isDelegated) {
      counterBase = "<Delegated>";
      const erInfo = await providerEphemeralRollup.connection.getAccountInfo(pda);
      counterER = erInfo?.data.readBigUInt64LE(8).toString() ?? "0";
    } else {
      const acc = await program.account.counter.fetch(pda);
      counterBase = acc.count.toNumber().toString();
      counterER = "<Not Delegated>";
    }
    console.log("--------------------------------");
    console.log(`| ${isDelegated ? "✅ Delegated" : "❌ Not Delegated"}`);
    console.log("--------------------------------");
    console.log("| Counter (Base): ", counterBase);
    console.log("| Counter (ER):   ", counterER);
    console.log("| High Score:     ", leaderboardAccount.highScore.toNumber());
    console.log("--------------------------------");
    console.log(message);
  }

  it("Initialize Counter", async () => {
    if (await provider.connection.getAccountInfo(pda)) {
      console.log("Counter already initialized");
      return;
    }
    const sig = await program.methods
      .initialize()
      .accounts({
        counter: pda,
        user: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc({ skipPreflight: true });
    await printCounter(`✅ Initialized. Sig: ${sig}`);
  });

  it("Increment Counter on base layer", async () => {
    const info = await provider.connection.getAccountInfo(pda);
    if (info?.owner.toBase58() === DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Skipping — counter is delegated");
      return;
    }
    const sig = await program.methods
      .increment()
      .accounts({ counter: pda })
      .rpc({ skipPreflight: true });
    console.log("✅ Incremented (base). Sig:", sig);
  });

  it("Update Leaderboard on base layer", async () => {
    const info = await provider.connection.getAccountInfo(pda);
    if (info?.owner.toBase58() === DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Skipping — counter is delegated");
      return;
    }
    const sig = await program.methods
      .updateLeaderboard()
      .accounts({
        counter: pda,
        escrowAuth: provider.wallet.publicKey,
        escrow: escrowPdaFromEscrowAuthority(provider.wallet.publicKey),
      })
      .rpc({ skipPreflight: true });
    await printCounter(`✅ Updated leaderboard. Sig: ${sig}`);
  });

  it("Delegate Counter and create Escrow", async () => {
    const info = await provider.connection.getAccountInfo(pda);
    if (info?.owner.toBase58() === DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Already delegated");
      return;
    }
    const validatorKey = new web3.PublicKey(
      process.env.VALIDATOR || "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
    );
    const remainingAccounts = [
      { pubkey: validatorKey, isSigner: false, isWritable: false },
    ];

    const topUpIx = createTopUpEscrowInstruction(
      escrowPdaFromEscrowAuthority(provider.wallet.publicKey),
      provider.wallet.publicKey,
      provider.wallet.publicKey,
      10000,
    );
    const delegateIx = await program.methods
      .delegate()
      .accounts({ payer: provider.wallet.publicKey, pda })
      .remainingAccounts(remainingAccounts)
      .instruction();

    const tx = new Transaction().add(topUpIx, delegateIx);
    const sig = await provider.sendAndConfirm(tx, [], { skipPreflight: true });
    await new Promise((r) => setTimeout(r, 1000));
    console.log("✅ Delegated. Sig:", sig);
  });

  it("Increment Counter in ER", async () => {
    const info = await provider.connection.getAccountInfo(pda);
    if (info?.owner.toBase58() !== DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Skipping — not delegated");
      return;
    }
    const tx = await program.methods.increment().accounts({ counter: pda }).transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
    const sig = await providerEphemeralRollup.sendAndConfirm(tx, [], { skipPreflight: true });
    await printCounter(`✅ Incremented (ER). Sig: ${sig}`);
  });

  it("Update Leaderboard while delegated", async () => {
    const info = await provider.connection.getAccountInfo(pda);
    if (info?.owner.toBase58() !== DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Skipping — not delegated");
      return;
    }
    const tx = await program.methods
      .commitAndUpdateLeaderboard()
      .accounts({ payer: provider.wallet.publicKey, programId: program.programId } as any)
      .transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
    const sig = await providerEphemeralRollup.sendAndConfirm(tx, [], { skipPreflight: true });
    await new Promise((r) => setTimeout(r, 2000));
    await printCounter(`✅ Updated leaderboard while delegated. Sig: ${sig}`);
  });

  it("Undelegate Counter", async () => {
    const info = await provider.connection.getAccountInfo(pda);
    if (info?.owner.toBase58() !== DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Skipping — not delegated");
      return;
    }
    const tx = await program.methods
      .undelegate()
      .accounts({ payer: provider.wallet.publicKey })
      .transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
    const sig = await providerEphemeralRollup.sendAndConfirm(tx, [], { skipPreflight: true });
    await new Promise((r) => setTimeout(r, 5000));
    await printCounter(`✅ Undelegated. Sig: ${sig}`);
  });

  it("Close Escrow", async () => {
    const ix = createCloseEscrowInstruction(
      escrowPdaFromEscrowAuthority(provider.wallet.publicKey),
      provider.wallet.publicKey,
    );
    const sig = await provider.sendAndConfirm(new Transaction().add(ix), [], { skipPreflight: true });
    console.log("✅ Escrow closed. Sig:", sig);
  });
});
