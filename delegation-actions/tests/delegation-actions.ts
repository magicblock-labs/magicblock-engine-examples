import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { DelegationActions } from "../target/types/delegation_actions";
import {
  ConnectionMagicRouter,
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

const COUNTER_SEED = "counter";

// Base ops go to the base layer; ER ops go straight to the rollup. The router is
// only used to discover the closest validator and its ER endpoint.
describe("delegation-actions", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const wallet = anchor.Wallet.local();

  const baseConnection = anchor.getProvider().connection;
  const program = anchor.workspace
    .delegationActions as Program<DelegationActions>;

  const routerConnection = new ConnectionMagicRouter(
    process.env.ROUTER_ENDPOINT || "https://devnet-router.magicblock.app",
    {
      wsEndpoint:
        process.env.ROUTER_WS_ENDPOINT || "wss://devnet-router.magicblock.app",
    },
  );

  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId,
  );

  let erConnection: web3.Connection;
  let validatorIdentity: web3.PublicKey;

  console.log("Base Endpoint: ", baseConnection.rpcEndpoint);
  console.log("Program ID:    ", program.programId.toBase58());
  console.log("Counter PDA:   ", pda.toBase58());

  async function isDelegated(): Promise<boolean> {
    const info = await baseConnection.getAccountInfo(pda);
    return info?.owner.toBase58() === DELEGATION_PROGRAM_ID.toBase58();
  }

  async function counterErValue(): Promise<number | null> {
    const info = await erConnection.getAccountInfo(pda);
    return info ? Number(info.data.readBigUInt64LE(8)) : null;
  }

  async function sendToEr(tx: Transaction): Promise<string> {
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;
    tx.sign(wallet.payer);
    const sig = await erConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    await erConnection.confirmTransaction(sig, "confirmed");
    return sig;
  }

  async function waitUntil(
    pred: () => Promise<boolean>,
    label: string,
    tries = 40,
  ): Promise<void> {
    for (let i = 0; i < tries; i++) {
      if (await pred()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  async function printCounter(message: string) {
    const delegated = await isDelegated();
    let base = "<n/a>";
    let er = "<n/a>";
    if (delegated) {
      base = "<Delegated>";
      er = (await counterErValue())?.toString() ?? "<n/a>";
    } else {
      const acc = await program.account.counter.fetch(pda);
      base = acc.count.toNumber().toString();
      er = "<Not Delegated>";
    }
    console.log("--------------------------------");
    console.log(`| ${delegated ? "✅ Delegated" : "❌ Not Delegated"}`);
    console.log("--------------------------------");
    console.log("| Counter (Base): ", base);
    console.log("| Counter (ER):   ", er);
    console.log("--------------------------------");
    console.log(message);
  }

  before(async () => {
    const validator = await routerConnection.getClosestValidator();
    console.log("Closest validator: ", JSON.stringify(validator));
    validatorIdentity = new web3.PublicKey(
      process.env.VALIDATOR || validator.identity,
    );
    erConnection = new web3.Connection(
      (validator.fqdn || "https://devnet-as.magicblock.app").replace(/\/$/, ""),
      "confirmed",
    );
    console.log("ER Endpoint:   ", erConnection.rpcEndpoint);

    // Self-heal: undelegate a counter left delegated by a prior run.
    if (await isDelegated()) {
      console.log("Counter is delegated from a prior run — undelegating...");
      const tx = await program.methods
        .undelegate()
        .accounts({ payer: wallet.publicKey })
        .transaction();
      await sendToEr(tx);
      await waitUntil(
        async () => !(await isDelegated()),
        "undelegation (reset)",
      );
      console.log("Reset complete — counter is undelegated.");
    }
  });

  it("Initialize Counter!", async () => {
    const tx = (await program.methods
      .initialize()
      .accounts({
        // @ts-ignore
        counter: pda,
        user: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction()) as Transaction;
    const sig = await sendAndConfirmTransaction(baseConnection, tx, [
      wallet.payer,
    ]);
    await printCounter(`✅ Initialized. Sig: ${sig}`);
  });

  it("Delegate Counter with a post-delegation action!", async () => {
    const sig = await sendAndConfirmTransaction(
      baseConnection,
      (await program.methods
        .delegateWithActions()
        .accounts({ payer: wallet.publicKey, pda })
        .remainingAccounts([
          { pubkey: validatorIdentity, isSigner: false, isWritable: false },
        ])
        .transaction()) as Transaction,
      [wallet.payer],
      { skipPreflight: true },
    );
    console.log("✅ Delegated with action. Sig:", sig);

    // The attached `increment` runs automatically in the ER once delegated.
    await waitUntil(
      async () => (await counterErValue()) === 1,
      "post-delegation action (ER count == 1)",
    );
    await printCounter(
      "✅ Post-delegation action executed automatically in the ER",
    );

    const er = await counterErValue();
    if (er !== 1) {
      throw new Error(`Post-delegation action did not run: ER count = ${er}`);
    }
  });

  it("Increment Counter on ER!", async () => {
    const before = await counterErValue();
    const sig = await sendToEr(
      await program.methods
        .increment()
        .accounts({ counter: pda })
        .transaction(),
    );
    await printCounter(`✅ Incremented (ER). Sig: ${sig}`);
    const after = await counterErValue();
    if (after !== (before ?? 0) + 1) {
      throw new Error(`ER increment failed: ${before} -> ${after}`);
    }
  });

  it("Undelegate Counter!", async () => {
    const sig = await sendToEr(
      await program.methods
        .undelegate()
        .accounts({ payer: wallet.publicKey })
        .transaction(),
    );
    await waitUntil(async () => !(await isDelegated()), "undelegation");
    await printCounter(`✅ Undelegated. Sig: ${sig}`);
  });
});
