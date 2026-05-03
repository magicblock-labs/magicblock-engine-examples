import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MagicActionsOnDelegation } from "../target/types/magic_actions_on_delegation";
import {
  ConnectionMagicRouter,
  DELEGATION_PROGRAM_ID,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  Connection,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { expect } from "chai";

const COUNTER_SEED = "counter";

describe("magic-actions-on-delegation", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace
    .MagicActionsOnDelegation as Program<MagicActionsOnDelegation>;

  const routerEndpoint =
    process.env.ROUTER_ENDPOINT || "https://devnet-router.magicblock.app";
  const routerWsEndpoint =
    process.env.ROUTER_WS_ENDPOINT ||
    "wss://devnet-router.magicblock.app";

  const routerConnection = new ConnectionMagicRouter(routerEndpoint, {
    wsEndpoint: routerWsEndpoint,
  });

  const isLocal =
    routerEndpoint.includes("localhost") ||
    routerEndpoint.includes("127.0.0.1");

  const baseConnection = new Connection(
    process.env.PROVIDER_ENDPOINT || "http://localhost:8899",
    { wsEndpoint: process.env.WS_ENDPOINT || "ws://localhost:8900" }
  );

  const erConnection = new Connection(
    process.env.ROUTER_ENDPOINT || "http://localhost:7799",
    { wsEndpoint: process.env.ROUTER_WS_ENDPOINT || "ws://localhost:7800" }
  );

  async function sendToBase(
    tx: Transaction,
    signers: anchor.web3.Signer[]
  ): Promise<string> {
    if (isLocal) {
      const { blockhash, lastValidBlockHeight } =
        await baseConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      return sendAndConfirmTransaction(baseConnection, tx, signers, {
        skipPreflight: true,
      });
    }
    return sendAndConfirmTransaction(routerConnection, tx, signers, {
      skipPreflight: true,
    });
  }

  async function sendToER(
    tx: Transaction,
    signers: anchor.web3.Signer[]
  ): Promise<string> {
    if (isLocal) {
      const { blockhash, lastValidBlockHeight } =
        await erConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      return sendAndConfirmTransaction(erConnection, tx, signers, {
        skipPreflight: true,
      });
    }
    return sendAndConfirmTransaction(routerConnection, tx, signers, {
      skipPreflight: true,
    });
  }

  const wallet = anchor.Wallet.local();

  const [counterPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId
  );

  const delegationRecord = delegationRecordPdaFromDelegatedAccount(counterPda);
  const delegationMetadata =
    delegationMetadataPdaFromDelegatedAccount(counterPda);

  console.log("Program ID:      ", program.programId.toBase58());
  console.log("Counter PDA:     ", counterPda.toBase58());
  console.log("Router Endpoint: ", routerEndpoint);

  async function readCounterOnBase(): Promise<number> {
    const acct = await program.account.counter.fetch(counterPda);
    return acct.count.toNumber();
  }

  async function readCounterOnER(): Promise<number> {
    const conn = isLocal ? erConnection : (routerConnection as unknown as Connection);
    const info = await conn.getAccountInfo(counterPda);
    if (!info) throw new Error("Counter account not found on ER");
    // Anchor account layout: 8-byte discriminator + 8-byte u64 (LE)
    return Number(info.data.readBigUInt64LE(8));
  }

  it("Initialize counter (count must be 0 on base)", async () => {
    // counter, systemProgram are auto-resolved by Anchor (PDA seeds / fixed address)
    const tx = (await program.methods
      .initialize()
      .accounts({
        user: wallet.publicKey,
      })
      .transaction()) as Transaction;

    await sendToBase(tx, [wallet.payer]);

    const count = await readCounterOnBase();
    console.log(`  Counter on base after init: ${count}`);
    expect(count).to.equal(0, "Counter should start at 0");
  });

  it("Delegate with queued increment action — no explicit increment sent", async () => {
    const validatorIdentity = isLocal
      ? "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"
      : (await routerConnection.getClosestValidator()).identity;

    const remainingAccounts = [
      {
        pubkey: new anchor.web3.PublicKey(validatorIdentity),
        isSigner: false,
        isWritable: false,
      },
    ];

    // pda, ownerProgram, delegateBuffer, systemProgram are auto-resolved by Anchor.
    // delegationRecord, delegationMetadata, delegationProgram have no seeds in the IDL.
    const delegateIx = await program.methods
      .delegate()
      .accounts({
        payer: wallet.publicKey,
        delegationRecord,
        delegationMetadata,
        delegationProgram: DELEGATION_PROGRAM_ID,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();

    const tx = new Transaction().add(delegateIx);
    const sig = await sendToBase(tx, [wallet.payer]);
    console.log(`  Delegate tx: ${sig}`);

    // Give the validator time to clone the account and fire the post-delegation action.
    await sleep(10);

    const count = await readCounterOnER();
    console.log(`  Counter on ER after delegation (no explicit increment): ${count}`);
    expect(count).to.equal(
      1,
      "Post-delegation increment action should have raised count to 1 automatically"
    );
  });

  it("Undelegate — counter should be 1 on base", async () => {
    // counter, magicProgram, magicContext are auto-resolved by Anchor.
    const tx = (await program.methods
      .undelegate()
      .accounts({
        payer: wallet.publicKey,
      })
      .transaction()) as Transaction;

    const sig = await sendToER(tx, [wallet.payer]);
    console.log(`  Undelegate tx: ${sig}`);

    // Wait for the base-layer commit to land.
    await sleep(8);

    const count = await readCounterOnBase();
    console.log(`  Counter on base after undelegate: ${count}`);
    expect(count).to.equal(
      1,
      "Count should still be 1 after undelegation — set by the post-delegation action"
    );
  });
});

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
