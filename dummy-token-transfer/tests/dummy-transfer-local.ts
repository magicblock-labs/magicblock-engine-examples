import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import { DummyTransfer } from "../target/types/dummy_transfer";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { PublicKey, Transaction } from "@solana/web3.js";

async function printBalances(
  program: Program<DummyTransfer>,
  andyBalancePda: web3.PublicKey,
  bobBalancePda: web3.PublicKey,
) {
  for (const [name, pda] of [
    ["Andy", andyBalancePda],
    ["Bob", bobBalancePda],
  ] as const) {
    try {
      const acc = await program.account.balance.fetch(pda);
      console.log(`${name} Balance: `, acc.balance.toString());
    } catch {
      console.log(`${name} Balance PDA not initialized`);
    }
  }
}

describe("dummy-transfer-local", () => {
  // Base layer = localhost solana-test-validator (or whatever PROVIDER_ENDPOINT points to).
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

  // ER = localhost ephemeral-validator (or EPHEMERAL_PROVIDER_ENDPOINT).
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

  const program = anchor.workspace.DummyTransfer as Program<DummyTransfer>;
  const bob = web3.Keypair.generate();

  const andyBalancePda = web3.PublicKey.findProgramAddressSync(
    [provider.wallet.publicKey.toBuffer()],
    program.programId,
  )[0];
  const bobBalancePda = web3.PublicKey.findProgramAddressSync(
    [bob.publicKey.toBuffer()],
    program.programId,
  )[0];

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    providerEphemeralRollup.connection.rpcEndpoint,
  );
  console.log("Program ID: ", program.programId.toBase58());
  console.log("Andy: ", provider.wallet.publicKey.toBase58());
  console.log("Bob: ", bob.publicKey.toBase58());

  before(async () => {
    if (
      provider.connection.rpcEndpoint.includes("localhost") ||
      provider.connection.rpcEndpoint.includes("127.0.0.1")
    ) {
      const sig = await provider.connection.requestAirdrop(
        provider.wallet.publicKey,
        2 * web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }
  });

  it("Initialize balances on base layer", async () => {
    if (!(await provider.connection.getAccountInfo(andyBalancePda))) {
      await program.methods
        .initialize()
        .accounts({ user: provider.wallet.publicKey })
        .rpc({ skipPreflight: true });
      console.log("✅ Initialized Andy Balance PDA");
    }
    if (!(await provider.connection.getAccountInfo(bobBalancePda))) {
      const transferIx = web3.SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: bob.publicKey,
        lamports: web3.LAMPORTS_PER_SOL * 0.01,
      });
      const initIx = await program.methods
        .initialize()
        .accounts({ user: bob.publicKey })
        .instruction();
      const tx = new web3.Transaction().add(transferIx).add(initIx);
      const sig = await provider.sendAndConfirm(tx, [bob], {
        skipPreflight: true,
      });
      console.log("✅ Initialized Bob Balance PDA. Sig:", sig);
    }
    await printBalances(program, andyBalancePda, bobBalancePda);
  });

  it("Transfer on base layer from Andy to Bob", async () => {
    const info = await provider.connection.getAccountInfo(andyBalancePda);
    if (info?.owner.toBase58() === DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("❌ Skipping — balances are delegated");
      return;
    }
    const sig = await program.methods
      .transfer(new BN(5))
      .accounts({ payer: provider.wallet.publicKey, receiver: bob.publicKey })
      .rpc({ skipPreflight: true });
    console.log("✅ Transferred 5 (base). Sig:", sig);
    await printBalances(program, andyBalancePda, bobBalancePda);
  });

  it("Delegate Andy and Bob balances", async () => {
    const info = await provider.connection.getAccountInfo(andyBalancePda);
    if (info?.owner.toBase58() === DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Already delegated");
      return;
    }
    const validatorKey = new PublicKey(
      process.env.VALIDATOR || "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
    );
    const params = { commitFrequencyMs: 30000, validator: validatorKey };
    const tx = await program.methods
      .delegate(params)
      .accounts({ payer: provider.wallet.publicKey })
      .postInstructions([
        await program.methods
          .delegate(params)
          .accounts({ payer: bob.publicKey })
          .instruction(),
      ])
      .transaction();
    const sig = await provider.sendAndConfirm(tx, [bob], {
      skipPreflight: true,
    });
    await new Promise((r) => setTimeout(r, 3000));
    console.log("✅ Delegated. Sig:", sig);
  });

  it("Transfer in the ephemeral rollup", async () => {
    const info = await provider.connection.getAccountInfo(andyBalancePda);
    if (info?.owner.toBase58() !== DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Skipping — not delegated");
      return;
    }
    const tx1 = await program.methods
      .transfer(new BN(5))
      .accounts({ payer: provider.wallet.publicKey, receiver: bob.publicKey })
      .transaction();
    tx1.feePayer = provider.wallet.publicKey;
    tx1.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    const sig1 = await providerEphemeralRollup.sendAndConfirm(tx1, [], {
      skipPreflight: true,
    });
    console.log("✅ Transferred 5 (ER). Sig:", sig1);

    const tx2 = await program.methods
      .transfer(new BN(15))
      .accounts({ payer: bob.publicKey, receiver: provider.wallet.publicKey })
      .transaction();
    tx2.feePayer = bob.publicKey;
    tx2.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx2.partialSign(bob);
    const sig2 = await providerEphemeralRollup.connection.sendRawTransaction(
      tx2.serialize(),
      { skipPreflight: true },
    );
    await providerEphemeralRollup.connection.confirmTransaction(
      sig2,
      "confirmed",
    );
    console.log("✅ Transferred 15 (ER). Sig:", sig2);
  });

  it("Undelegate Andy and Bob balances", async () => {
    const info = await provider.connection.getAccountInfo(andyBalancePda);
    if (info?.owner.toBase58() !== DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Skipping — not delegated");
      return;
    }
    const tx1 = await program.methods
      .undelegate()
      .accounts({ payer: provider.wallet.publicKey })
      .transaction();
    tx1.feePayer = provider.wallet.publicKey;
    tx1.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    const sig1 = await providerEphemeralRollup.sendAndConfirm(tx1, [], {
      skipPreflight: true,
    });

    const tx2 = await program.methods
      .undelegate()
      .accounts({ payer: bob.publicKey })
      .transaction();
    tx2.feePayer = bob.publicKey;
    tx2.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx2.partialSign(bob);
    const sig2 = await providerEphemeralRollup.connection.sendRawTransaction(
      tx2.serialize(),
      { skipPreflight: true },
    );
    await providerEphemeralRollup.connection.confirmTransaction(
      sig2,
      "confirmed",
    );

    await new Promise((r) => setTimeout(r, 5000));
    console.log("✅ Undelegated. Sigs:", sig1, sig2);
    await printBalances(program, andyBalancePda, bobBalancePda);
  });
});
