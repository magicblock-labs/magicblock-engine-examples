import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { AnchorCounter } from "../target/types/anchor_counter";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { expect } from "chai";

const COUNTER_SEED = "counter";

describe("crank-counter", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AnchorCounter as Program<AnchorCounter>;

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://devnet-as.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT ||
          "wss://devnet-as.magicblock.app/",
      },
    ),
    anchor.Wallet.local(),
  );
  const programEphemeralRollup = new Program<AnchorCounter>(
    program.idl,
    providerEphemeralRollup,
  );
  let validatorIdentity: PublicKey;

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

    validatorIdentity = await fetch(
      providerEphemeralRollup.connection.rpcEndpoint,
      {
        method: "POST",
        body: JSON.stringify({
          method: "getIdentity",
          id: "1",
          jsonrpc: "2.0",
          params: [{ commitment: "confirmed" }],
        }),
      },
    )
      .then((response) => response.json())
      .then((data: any) => new PublicKey(data.result.identity));
  });

  const [counterPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId,
  );

  console.log("Program ID: ", program.programId.toString());
  console.log("Counter PDA: ", counterPDA.toString());

  it("Initialize counter on Solana", async () => {
    const txHash = await program.methods
      .initialize()
      .accounts({
        user: provider.wallet.publicKey,
      })
      .rpc();
    console.log(`[Base Layer] Initialize txHash: ${txHash}`);
  });

  it("Delegate counter to ER", async () => {
    const txHash = await program.methods
      .delegate()
      .accounts({
        payer: provider.wallet.publicKey,
        pda: counterPDA,
      })
      .remainingAccounts([
        { pubkey: validatorIdentity, isSigner: false, isWritable: false },
      ])
      .rpc();
    console.log(`[Base Layer] Delegate txHash: ${txHash}`);
  });

  it("Schedule increment counter on ER", async () => {
    const counterValueBefore = await programEphemeralRollup.account.counter
      .fetch(counterPDA)
      .then((counter) => counter.count);
    const txHash = await programEphemeralRollup.methods
      .scheduleIncrement({
        taskId: new BN(1), // Task ID can be arbitrary, used mostly to cancel cranks.
        executionIntervalMillis: new BN(100), // Milliseconds between executions.
        iterations: new BN(3), // Number of times to execute the task.
      })
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
      })
      .rpc();
    console.log(`[ER] Schedule Increment txHash: ${txHash}`);

    let retries = 10;
    let counterValueAfter: BN;
    while (retries > 0) {
      counterValueAfter = await programEphemeralRollup.account.counter
        .fetch(counterPDA)
        .then((counter) => counter.count);
      console.log(
        `[ER] Counter value after schedule increment: ${counterValueAfter}`,
      );
      if (counterValueAfter.toNumber() >= counterValueBefore.toNumber() + 3) {
        break;
      }
      retries--;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    expect(counterValueAfter.toNumber()).to.be.equal(
      counterValueBefore.toNumber() + 3,
    );
  });

  it("Permissioned increment counter on ER fails", async () => {
    try {
      await programEphemeralRollup.methods
        .incrementPermissioned()
        .accounts({
          crankSigner: providerEphemeralRollup.wallet.publicKey,
        })
        .rpc();
      expect(true).to.be.false; // Should fail
    } catch (error) {
      console.log(`[ER] Permissioned increment failed: ${error}`);
    }
  });

  it("Schedule permissioned increment counter on ER", async () => {
    const counterValueBefore = await programEphemeralRollup.account.counter
      .fetch(counterPDA)
      .then((counter) => counter.count);
    const txHash = await programEphemeralRollup.methods
      .scheduleIncrementPermissioned({
        taskId: new BN(1), // Task ID can be arbitrary, used mostly to cancel cranks.
        executionIntervalMillis: new BN(100), // Milliseconds between executions.
        iterations: new BN(3), // Number of times to execute the task.
      })
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
      })
      .rpc();
    console.log(`[ER] Schedule Permissioned Increment txHash: ${txHash}`);

    let retries = 10;
    let counterValueAfter: BN;
    while (retries > 0) {
      counterValueAfter = await programEphemeralRollup.account.counter
        .fetch(counterPDA)
        .then((counter) => counter.count);
      console.log(
        `[ER] Counter value after schedule permissioned increment: ${counterValueAfter}`,
      );
      if (counterValueAfter.toNumber() >= counterValueBefore.toNumber() + 3) {
        break;
      }
      retries--;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    expect(counterValueAfter.toNumber()).to.be.equal(
      counterValueBefore.toNumber() + 3,
    );
  });

  it("Undelegate counter on ER to Solana", async () => {
    const txHash = await programEphemeralRollup.methods
      .undelegate()
      .accounts({
        payer: providerEphemeralRollup.wallet.publicKey,
      })
      .rpc();
    console.log(`[ER] Undelegate txHash: ${txHash}`);
    await GetCommitmentSignature(txHash, providerEphemeralRollup.connection);
  });

  after(async () => {
    // Exit process to prevent hanging on WebSocket connections
    setTimeout(() => process.exit(0), 100);
  });
});
