import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { MagicActions } from "../target/types/magic_actions";
import {
  getDelegationStatus, DELEGATION_PROGRAM_ID, getClosestValidator, sendMagicTransaction, getLatestBlockhashForMagicTransaction
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { Transaction } from "@solana/web3.js";

const SEED_TEST_PDA = "test-pda";

describe("magic-actions", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.magicActions as Program<MagicActions>;


   // Configure the router endpoint for Magic Router
   const routerConnection = new web3.Connection(
    process.env.ROUTER_ENDPOINT || "https://devnet-router.magicblock.app",
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
    const signature = await sendMagicTransaction(
      routerConnection,
      tx,
      [anchor.Wallet.local().payer]
    );
    console.log("✅ Initialized Counter PDA! Signature:", signature);
    await printCounter(program, pda, routerConnection);
  });

  it("Increment Counter!", async () => {
    const tx = await program.methods
      .increment()
      .accounts({
        counter: pda,
      })
      .transaction() as Transaction;

    const signature = await sendMagicTransaction(
      routerConnection,
      tx,
      [anchor.Wallet.local().payer]
    );
    console.log("✅ Incremented Counter PDA! Signature:", signature);
    await printCounter(program, pda, routerConnection);
  });

  it("Delegate Counter to ER!", async () => {
    const validatorKey = await getClosestValidator(routerConnection);
    console.log("Delegating to closest validator: ", validatorKey.toString());
    
    const tx = await program.methods
    .delegate()
    .accounts({
      payer: anchor.Wallet.local().publicKey,
      pda: pda,
    })
    .transaction();

  const signature = await sendMagicTransaction(
    routerConnection,
    tx,
    [anchor.Wallet.local().payer]
  );
  console.log("✅ Delegated Counter PDA! Signature:", signature);
  await printCounter(program, pda, routerConnection);
  });


  it("Increment Counter on ER!", async () => {
    const tx = await program.methods
      .increment()
      .accounts({
        counter: pda,
      })
      .transaction();

    const signature = await sendMagicTransaction(
      routerConnection,
      tx,
      [anchor.Wallet.local().payer]
    );

    console.log("✅ Incremented Counter PDA! Signature:", signature);
    await printCounter(program, pda, routerConnection);
  });

  it("Undelegate Counter!", async () => {
    const tx = await program.methods
      .undelegate()
      .accounts({
        payer: anchor.Wallet.local().publicKey,
      })
      .transaction();

    const signature = await sendMagicTransaction(
      routerConnection,
      tx,
      [anchor.Wallet.local().payer]
    );
    console.log("✅ Undelegated Counter PDA! Signature:", signature);
    await printCounter(program, pda, routerConnection);
  });
});

// Helper function to print the current value of the counter on base layer and ER.
async function printCounter(program: Program<MagicActions>, pda: web3.PublicKey, routerConnection: web3.Connection){
  console.log("--------------------------------");
  console.log("|             Status");
  console.log("--------------------------------");
  const delegationStatus = await getDelegationStatus(routerConnection, pda);
  console.log("| Is Delegated: ", delegationStatus.isDelegated);
  const counterAccount = await program.account.counter.fetch(pda); // Fetchs on Devnet
  console.log("| Counter Value: ", counterAccount.count.toNumber());
  console.log("--------------------------------");

}