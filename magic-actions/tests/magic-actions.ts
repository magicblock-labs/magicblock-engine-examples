import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { MagicActions } from "../target/types/magic_actions";
import {
  DELEGATION_PROGRAM_ID, getClosestValidator, getLatestBlockhashForMagicTransaction
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { Transaction } from "@solana/web3.js";
import { sendMagicTransaction } from "magic-router-sdk";

const SEED_TEST_PDA = "test-pda";

describe("magic-actions", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.magicActions as Program<MagicActions>;


   // Configure the router endpoint for Magic Router
   const routerConnection = new web3.Connection(
    process.env.ROUTER_ENDPOINT || "http://127.0.0.1:8080",
    {
      wsEndpoint: process.env.ROUTER_WS_ENDPOINT || "wss://devnet-router.magicblock.app",
    }
  );

  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_TEST_PDA)],
    program.programId
  );

  console.log("Router Endpoint: ", routerConnection.rpcEndpoint)
  console.log("Program ID: ", program.programId.toBase58());
  console.log("Counter PDA: ", pda.toBase58());

  it("Initialize Counter!", async () => {
    const tx = await program.methods
    .initialize()
    .accounts({
      // @ts-ignore
      counter: pda,
      user: anchor.Wallet.local().publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .transaction() as Transaction;

    // console.log("Getting blockhash for tx");
    // const blockhash = await getLatestBlockhashForMagicTransaction(routerConnection, tx);
    // console.log("Blockhash: ", blockhash);

    await sendMagicTransaction(
      routerConnection,
      tx,
      [anchor.Wallet.local().payer]
    );
    // console.log("✅ Initialized Counter PDA! Signature:", signature);
    await printCounter(program, pda);
  });

  it("Increment Counter!", async () => {
    const tx = await program.methods
      .increment()
      .accounts({
        counter: pda,
      })
      .transaction() as Transaction;

    await sendMagicTransaction(
      routerConnection,
      tx,
      [anchor.Wallet.local().payer]
    );
    // console.log("✅ Incremented Counter PDA! Signature:", signature);
    await printCounter(program, pda);
  });
});

// Helper function to print the current value of the counter on base layer and ER.
async function printCounter(program: Program<MagicActions>, pda: web3.PublicKey){
  const counterAccount = await program.account.counter.fetch(pda);
  console.log("Counter Value: ", counterAccount.count);
}