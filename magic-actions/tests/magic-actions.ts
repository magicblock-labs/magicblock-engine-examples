import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { MagicActions } from "../target/types/magic_actions";
import {
  ConnectionMagicRouter,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

const SEED_TEST_PDA = "test-pda";
const SEED_LEADERBOARD = "leaderboard";



describe("magic-actions", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.magicActions as Program<MagicActions>;

  const routerConnection: ConnectionMagicRouter = new ConnectionMagicRouter(
    process.env.ROUTER_ENDPOINT || "https://devnet-router.magicblock.app",
    {
      wsEndpoint: process.env.ROUTER_WS_ENDPOINT || "wss://devnet-router.magicblock.app",
    }
  );

  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_TEST_PDA)],
    program.programId
  );

  const [leaderboard_pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_LEADERBOARD)],
    program.programId
  );

  console.log("Router Endpoint: ", routerConnection.rpcEndpoint)
  console.log("Program ID: ", program.programId.toBase58());
  console.log("Counter PDA: ", pda.toBase58());
  console.log("Leaderboard PDA: ", leaderboard_pda.toBase58());

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
    const signature = await sendAndConfirmTransaction(
      routerConnection,
      tx,
      [anchor.Wallet.local().payer]
    );
    await printCounter(program, pda, leaderboard_pda, routerConnection, signature, "✅ Initialized Counter PDA!");
  });

  it("Increment Counter!", async () => {
    const tx = await program.methods
      .increment()
      .accounts({
        counter: pda,
      })
      .transaction() as Transaction;

    const signature = await sendAndConfirmTransaction(
      routerConnection,
      tx,
      [anchor.Wallet.local().payer]
    );
    console.log("✅ Incremented Counter PDA! Signature:", signature);
  });

  it("Update Leaderboard!", async () => {
    const tx = await program.methods
      .updateLeaderboard()
      .accounts({
        counter: pda,
        escrow: pda,
        escrowAuth: pda,
      })
      .transaction();

    const signature = await sendAndConfirmTransaction(
      routerConnection,
      tx,
      [anchor.Wallet.local().payer]
    );

    await printCounter(program, pda, leaderboard_pda, routerConnection, signature, "✅ Updated Leaderboard!");
  });

  it("Delegate Counter to ER!", async () => {
    const validator = (await routerConnection.getClosestValidator());
    console.log("Delegating to closest validator: ", JSON.stringify(validator));

        // Add local validator identity to the remaining accounts if running on localnet
    const remainingAccounts =
      routerConnection.rpcEndpoint.includes("localhost") ||
      routerConnection.rpcEndpoint.includes("127.0.0.1")
        ? [
            {
              pubkey: new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
              isSigner: false,
              isWritable: false,
            },
          ]
        : [
            {
              pubkey: new web3.PublicKey(validator.identity),
              isSigner: false,
              isWritable: false,
            },
        ];

    const tx = await program.methods
      .delegate()
      .accounts({
        payer: anchor.Wallet.local().publicKey,
        pda: pda
      })
      .remainingAccounts(remainingAccounts)
      .transaction();

    const signature = await sendAndConfirmTransaction(
      routerConnection,
      tx,
      [anchor.Wallet.local().payer]
    );

    await sleepWithAnimation(10); // ensure the delegation is processed
    console.log("✅ Delegated Counter PDA! Signature:", signature);
  });


  it("Increment Counter on ER!", async () => {
    const tx = await program.methods
      .increment()
      .accounts({
        counter: pda,
      })
      .transaction();

    const signature = await sendAndConfirmTransaction(
      routerConnection,
      tx,
      [anchor.Wallet.local().payer]
    );

    await printCounter(program, pda, leaderboard_pda, routerConnection, signature, "✅ Incremented Counter PDA!");
  });

  it("Update Leaderboard While Delegated!", async () => {
    const tx = await program.methods
      .commitAndUpdateLeaderboard()
      .accounts({
        payer: anchor.Wallet.local().publicKey,
        programId: program.programId,
      })
      .transaction();

      const signature = await sendAndConfirmTransaction(
        routerConnection,
        tx,
        [anchor.Wallet.local().payer]
      );

      await sleepWithAnimation(5);
      await printCounter(program, pda, leaderboard_pda, routerConnection, signature, "✅ Updated Leaderboard While Delegated!");
  });

  it("Undelegate Counter!", async () => {
    const tx = await program.methods
      .undelegate()
      .accounts({
        payer: anchor.Wallet.local().publicKey,
      })
      .transaction();

    const signature = await sendAndConfirmTransaction(
      routerConnection,
      tx,
      [anchor.Wallet.local().payer]
    );
    await sleepWithAnimation(5);
    await printCounter(program, pda, leaderboard_pda, routerConnection, signature, "✅ Undelegated Counter PDA!");
  });
});

async function printCounter(program: Program<MagicActions>, counter_pda: web3.PublicKey, leaderboard_pda: web3.PublicKey, routerConnection: ConnectionMagicRouter, signature: string, message: string) {
  console.log(message+" Signature: ", signature);
  const delegationStatus = await routerConnection.getDelegationStatus(counter_pda);
  const leaderboardAccount = await program.account.leaderboard.fetch(leaderboard_pda);

  var counterER = "";
  var counterBase = "";
  var delegationStatusMsg = "";

  if (delegationStatus.isDelegated) {
    const counterAccountER = await routerConnection.getAccountInfo(counter_pda);
    const countValue = counterAccountER?.data.readBigUInt64LE(8);
    counterER = countValue?.toString() || "0";
    counterBase = "<Delegated>";
    delegationStatusMsg = "✅ Delegated";
  } else {
    counterER = "<Not Delegated>";
    const counterAccount = await program.account.counter.fetch(counter_pda); // Fetchs on Devnet
    counterBase = counterAccount.count.toNumber().toString();
    delegationStatusMsg = "❌ Not Delegated";
  }


  console.log("--------------------------------");
  console.log("| "+delegationStatusMsg);
  console.log("--------------------------------");
  console.log("| Counter (Base): ", counterBase);
  console.log("| Counter (ER): ", counterER);
  console.log("| High Score: ", leaderboardAccount.highScore.toNumber());
  console.log("--------------------------------");

}

async function sleepWithAnimation(seconds: number): Promise<void> {
  const totalMs = seconds * 1000;
  const interval = 500; // Update every 500ms
  const iterations = Math.floor(totalMs / interval);

  for (let i = 0; i < iterations; i++) {
    const dots = '.'.repeat((i % 3) + 1);
    process.stdout.write(`\rWaiting${dots}   `);
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  // Clear the line
  process.stdout.write('\r\x1b[K');
}