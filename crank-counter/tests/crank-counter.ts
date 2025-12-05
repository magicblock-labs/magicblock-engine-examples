import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import { AnchorCounter } from "../target/types/anchor_counter";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { GetCommitmentSignature, ConnectionMagicRouter, MAGIC_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";

const COUNTER_SEED = "counter"; 

describe("crank-counter", () => {

  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://devnet-as.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app/",
      },
    ),
    anchor.Wallet.local(),
  );

  const routerConnection: ConnectionMagicRouter = new ConnectionMagicRouter(
    process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
      "https://devnet-router.magicblock.app/",
    {
      wsEndpoint:
        process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app/",
    }
  );

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    providerEphemeralRollup.connection.rpcEndpoint,
  );
  console.log(`Current SOL Public Key: ${anchor.Wallet.local().publicKey}`);

  before(async function () {
    const balance = await provider.connection.getBalance(
      anchor.Wallet.local().publicKey,
    );
    console.log("Current balance is", balance / LAMPORTS_PER_SOL, " SOL", "\n");
  });

  const program = anchor.workspace.AnchorCounter as Program<AnchorCounter>;
  const [counterPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId,
  );

  console.log("Program ID: ", program.programId.toString());
  console.log("Counter PDA: ", counterPDA.toString());

  xit("Initialize counter on Solana", async () => {
    const start = Date.now();
    let tx = await program.methods
      .initialize()
      .accounts({
        user: provider.wallet.publicKey,
      })
      .transaction();

    const txHash = await provider.sendAndConfirm(tx, [provider.wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) Initialize txHash: ${txHash}`);
  });

  xit("Increase counter on Solana", async () => {
    const start = Date.now();
    let tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
      })
      .transaction();
    const txHash = await provider.sendAndConfirm(tx, [provider.wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) Increment txHash: ${txHash}`);
  });

  xit("Delegate counter to ER", async () => {
    const start = Date.now();
    // Add local validator identity to the remaining accounts if running on localnet
    const remainingAccounts =
      providerEphemeralRollup.connection.rpcEndpoint.includes("localhost") ||
      providerEphemeralRollup.connection.rpcEndpoint.includes("127.0.0.1")
        ? [
            {
              pubkey: new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
              isSigner: false,
              isWritable: false,
            },
          ]
        : [];
    let tx = await program.methods
      .delegate()
      .accounts({
        payer: provider.wallet.publicKey,
        pda: counterPDA,
      })
      .remainingAccounts(remainingAccounts)
      .transaction();
    const txHash = await provider.sendAndConfirm(tx, [provider.wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    const duration = Date.now() - start;
    console.log(`${duration}ms (Base Layer) Delegate txHash: ${txHash}`);
  });

  xit("Increase counter on ER", async () => {
    const start = Date.now();
    let tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
      })
      .transaction();
    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx);
    const duration = Date.now() - start;
    console.log(`${duration}ms (ER) Increment txHash: ${txHash}`);
  });

  it("Schedule increment counter on ER", async () => {
    const start = Date.now();
    let tx = await program.methods
      .scheduleIncrement({
        taskId: new BN(1),
        executionIntervalMillis: new BN(100),
        iterations: new BN(3),
      })
      .accounts({
        magicProgram: MAGIC_PROGRAM_ID,
        payer: providerEphemeralRollup.wallet.publicKey,
        program: program.programId,
      })
      .transaction();
    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);

    const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: true,
    });
    const duration = Date.now() - start;
    console.log(`${duration}ms (ER) Schedule Increment txHash: ${txHash}`);
  });

  xit("Increment and undelegate counter on ER to Solana", async () => {
    const start = Date.now();
    let tx = await program.methods
      .incrementAndUndelegate()
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
      })
      .transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);

    const txHash = await providerEphemeralRollup.sendAndConfirm(tx);
    const duration = Date.now() - start;
    console.log(`${duration}ms (ER) Increment and Undelegate txHash: ${txHash}`);

    await sleepWithAnimation(4);
    
    await printCounter(program, counterPDA, routerConnection, txHash, "✅ After Scheduled Increments");

  });
});

async function printCounter(program: Program<AnchorCounter>, counter_pda: web3.PublicKey, routerConnection: ConnectionMagicRouter, signature: string, message: string) {
  console.log(message+" Signature: ", signature);
  const delegationStatus = await routerConnection.getDelegationStatus(counter_pda);

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
    const counterAccount = await program.account.counter.fetch(counter_pda);
    counterBase = counterAccount.count.toNumber().toString();
    delegationStatusMsg = "❌ Not Delegated";
  }

  console.log("--------------------------------");
  console.log("| "+delegationStatusMsg);
  console.log("--------------------------------");
  console.log("| Counter (Base): ", counterBase);
  console.log("| Counter (ER): ", counterER);
  console.log("--------------------------------");
}

async function sleepWithAnimation(seconds: number): Promise<void> {
  const totalMs = seconds * 1000;
  const interval = 500;
  const iterations = Math.floor(totalMs / interval);

  for (let i = 0; i < iterations; i++) {
    const dots = '.'.repeat((i % 3) + 1);
    process.stdout.write(`\rWaiting${dots}   `);
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  process.stdout.write('\r\x1b[K');
}
