import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { DelegationActions } from "../target/types/delegation_actions";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";

const COUNTER_SEED = "counter";

describe("delegation-actions-local", () => {
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

  const program = anchor.workspace
    .delegationActions as Program<DelegationActions>;
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId,
  );

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    providerEphemeralRollup.connection.rpcEndpoint,
  );
  console.log("Program ID: ", program.programId.toBase58());
  console.log("Counter PDA: ", pda.toBase58());

  async function getCounterER(): Promise<number | null> {
    const info = await providerEphemeralRollup.connection.getAccountInfo(pda);
    if (!info) return null;
    return Number(info.data.readBigUInt64LE(8));
  }

  async function printCounter(message: string) {
    const counterInfo = await provider.connection.getAccountInfo(pda);
    const isDelegated =
      counterInfo?.owner.toBase58() === DELEGATION_PROGRAM_ID.toBase58();

    let counterBase = "<n/a>";
    let counterER = "<n/a>";
    if (isDelegated) {
      counterBase = "<Delegated>";
      counterER = (await getCounterER())?.toString() ?? "<n/a>";
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
    await printCounter("Counter incremented on base layer");
  });

  it("Delegate Counter with a post-delegation action", async () => {
    const info = await provider.connection.getAccountInfo(pda);
    if (info?.owner.toBase58() === DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Already delegated");
      return;
    }

    // Snapshot the count before delegation so we can assert the attached
    // post-delegation action ran automatically inside the ER.
    const before = (await program.account.counter.fetch(pda)).count.toNumber();

    const validatorKey = new web3.PublicKey(
      process.env.VALIDATOR || "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
    );
    const remainingAccounts = [
      { pubkey: validatorKey, isSigner: false, isWritable: false },
    ];

    // `delegate_with_actions` delegates the counter AND attaches an `increment`
    // action. The ER validator runs that action automatically once the account
    // is delegated — no separate increment transaction is sent here.
    const sig = await program.methods
      .delegateWithActions()
      .accounts({ payer: provider.wallet.publicKey, pda })
      .remainingAccounts(remainingAccounts)
      .rpc({ skipPreflight: true });
    console.log("✅ Delegated with action. Sig:", sig);

    // Wait for the ER to clone the account and run the post-delegation action.
    let after: number | null = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      after = await getCounterER();
      if (after !== null && after === before + 1) break;
    }
    await printCounter(
      `Post-delegation action result — ER counter: ${after} (was ${before})`,
    );

    if (after !== before + 1) {
      throw new Error(
        `Post-delegation action did not run: expected ${
          before + 1
        } in ER, got ${after}`,
      );
    }
    console.log("✅ Post-delegation action executed automatically in the ER");
  });

  it("Increment Counter in ER", async () => {
    const info = await provider.connection.getAccountInfo(pda);
    if (info?.owner.toBase58() !== DELEGATION_PROGRAM_ID.toBase58()) {
      console.log("Skipping — not delegated");
      return;
    }
    const tx = await program.methods
      .increment()
      .accounts({ counter: pda })
      .transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    const sig = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: true,
    });
    await printCounter(`✅ Incremented (ER). Sig: ${sig}`);
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
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    const sig = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: true,
    });
    await new Promise((r) => setTimeout(r, 5000));
    await printCounter(`✅ Undelegated. Sig: ${sig}`);
  });
});
