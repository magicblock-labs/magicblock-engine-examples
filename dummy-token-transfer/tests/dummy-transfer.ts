import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import { DummyTransfer } from "../target/types/dummy_transfer";
import {
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { getClosestValidator, sendMagicTransaction } from "magic-router-sdk";
import { Transaction} from "@solana/web3.js";

// Helper function to print balances of all accounts
async function printBalances(program: Program<DummyTransfer>, andyBalancePda: web3.PublicKey, bobBalancePda: web3.PublicKey) {
  let andyBalanceAccount, bobBalanceAccount;
  try {
    andyBalanceAccount = await program.account.balance.fetch(andyBalancePda);
  } catch (e) {
    andyBalanceAccount = null;
  }
  try {
    bobBalanceAccount = await program.account.balance.fetch(bobBalancePda);
  } catch (e) {
    bobBalanceAccount = null;
  }

  if (andyBalanceAccount) {
    console.log("Andy Balance: ", andyBalanceAccount.balance.toString());
  } else {
    console.log("Andy Balance PDA not initialized");
  }
  if (bobBalanceAccount) {
    console.log("Bob Balance: ", bobBalanceAccount.balance.toString());
  } else {
    console.log("Bob Balance PDA not initialized");
  }
}

describe("dummy-transfer", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Configure the router endpoint for Magic Router
  const routerConnection = new web3.Connection(
    process.env.ROUTER_ENDPOINT || "https://devnet-router.magicblock.app",
    {
      wsEndpoint: process.env.ROUTER_WS_ENDPOINT || "wss://devnet-router.magicblock.app",
    }
  );

  console.log("Router Endpoint: ", routerConnection.rpcEndpoint)

  const program = anchor.workspace.DummyTransfer as Program<DummyTransfer>;

  const bob = web3.Keypair.generate();

  const andyBalancePda = web3.PublicKey.findProgramAddressSync(
    [provider.wallet.publicKey.toBuffer()],
    program.programId
  )[0];

  const bobBalancePda = web3.PublicKey.findProgramAddressSync(
    [bob.publicKey.toBuffer()],
    program.programId
  )[0];

  console.log("Program ID: ", program.programId.toBase58());
  console.log("Andy Public Key: ", provider.wallet.publicKey.toBase58());
  console.log("Bob Public Key: ", bob.publicKey.toBase58());
  console.log("Andy Balance PDA: ", andyBalancePda.toBase58());
  console.log("Bob Balance PDA: ", bobBalancePda.toBase58());

  before(async () => {
    // If running locally, airdrop SOL to the wallet.
    if (
      provider.connection.rpcEndpoint.includes("localhost") ||
      provider.connection.rpcEndpoint.includes("127.0.0.1")
    ) {
      // Airdrop to bob
      const andyAirdropSignature = await provider.connection.requestAirdrop(
        provider.wallet.publicKey,
        2 * web3.LAMPORTS_PER_SOL
      );
    }
  });

  it("Initialize balances if not already initialized.", async () => {
    const andyBalancePDA = await provider.connection.getAccountInfo(
      andyBalancePda
    );
    const bobBalancePDA = await provider.connection.getAccountInfo(
      bobBalancePda
    );

    if(!andyBalancePDA) {
    const tx = await program.methods
      .initialize()
      .accounts({
        user: provider.wallet.publicKey,
      })
      .transaction() as Transaction;

    const signature = await sendMagicTransaction(
      routerConnection,
      tx,
      [provider.wallet.payer]
    );
    console.log("✅ Initialized Andy Balance PDA! Signature:", signature);
    } 
    else {
      console.log("✅ Andy Balance PDA already initialized!");
    }

    if (!bobBalancePDA) {
      const transferIx = web3.SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: bob.publicKey,
        lamports: web3.LAMPORTS_PER_SOL * 0.01,
      });
      // Build the initialize instruction
      const initIx = await program.methods
        .initialize()
        .accounts({
          user: bob.publicKey,
        })
        .instruction();
      const tx = new web3.Transaction()
        .add(transferIx)
        .add(initIx);

      const signature = await sendMagicTransaction(
        routerConnection,
        tx,
        [provider.wallet.payer, bob]
      );
      console.log("✅ Initialized Bob Balance PDA! Signature:", signature);
    } else {
      console.log("✅ Bob Balance PDA already initialized!");
    }

    await printBalances(program, andyBalancePda, bobBalancePda);
  });

  it("Transfer on base chain from Andy to Bob", async () => {
    const balanceAccountInfo = await provider.connection.getAccountInfo(
      andyBalancePda
    );
    if (
      balanceAccountInfo.owner.toBase58() == DELEGATION_PROGRAM_ID.toBase58()
    ) {
      console.log("❌ Cannot transfer: Balances are currently delegated");
      return;
    }

    const tx = await program.methods
      .transfer(new BN(5))
      .accounts({
        payer: provider.wallet.publicKey,
        receiver: bob.publicKey,
      })
      .transaction();

    const signature = await sendMagicTransaction(
      routerConnection,
      tx,
      [provider.wallet.payer]
    );
    console.log("✅ Transfered 5 from Andy to Bob");
    console.log("Transfer Tx: ", signature);

    await printBalances(program, andyBalancePda, bobBalancePda);
  });

  it("Delegate Balances of Andy and Bob", async () => {
    const balanceAccountInfo = await provider.connection.getAccountInfo(
      andyBalancePda
    );
    if (
      balanceAccountInfo.owner.toBase58() == DELEGATION_PROGRAM_ID.toBase58()
    ) {
      console.log("❌ Balance is already delegated");
      return;
    }

    const validatorKey = await getClosestValidator(routerConnection);
    const tx = await program.methods
      .delegate({
        commitFrequencyMs: 30000,
        validator: validatorKey,
      })
      .accounts({
        payer: provider.wallet.publicKey,
      })
      .postInstructions([
        await program.methods
          .delegate({
        commitFrequencyMs: 30000,
        validator: validatorKey,
      })
          .accounts({
            payer: bob.publicKey,
          })
          .instruction()
      ])
      .transaction();

    const signature = await sendMagicTransaction(
      routerConnection,
      tx,
      [provider.wallet.payer, bob]
    );

    // Naive wait for the transaction to be confirmed on the base chain. Better pattern incoming soon.
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log("✅ Delegated Balances of Andy and Bob");
    console.log("Delegation signature", signature);
  });

  it("Perform transfers in the ephemeral rollup", async () => {
    const balanceAccountInfo = await provider.connection.getAccountInfo(
      andyBalancePda
    );
    if (
      balanceAccountInfo.owner.toBase58() != DELEGATION_PROGRAM_ID.toBase58()
    ) {
      console.log("Balance is not delegated");
      return;
    }

    const tx1 = await program.methods
      .transfer(new BN(5))
      .accounts({
        payer: provider.wallet.publicKey,
        receiver: bob.publicKey,
      })
      .transaction();

    const signature1 = await sendMagicTransaction(
      routerConnection,
      tx1,
      [provider.wallet.payer]
    );
    console.log("✅ Transfered 5 from Andy to Bob in the ephemeral rollup");
    console.log("Transfer Tx: ", signature1);

    const tx2 = await program.methods
      .transfer(new BN(15))
      .accounts({
        payer: bob.publicKey,
        receiver: provider.wallet.publicKey,
      })
      .transaction();

    const signature2 = await sendMagicTransaction(
      routerConnection,
      tx2,
      [bob]
    );
    console.log("✅ Transfered 15 from Bob to Andy in the ephemeral rollup");
    console.log("Transfer Tx: ", signature2);
  });

  it("Undelegate Balances of Andy and Bob", async () => {
    const balanceAccountInfo = await provider.connection.getAccountInfo(
      andyBalancePda
    );
    if (
      balanceAccountInfo.owner.toBase58() != DELEGATION_PROGRAM_ID.toBase58()
    ) {
      console.log("Balance is not delegated");
      return;
    }

    const tx1 = await program.methods
      .undelegate()
      .accounts({
        payer: provider.wallet.publicKey,
      })
      .transaction();

    const signature1 = await sendMagicTransaction(
      routerConnection,
      tx1,
      [provider.wallet.payer]
    );

    const tx2 = await program.methods
      .undelegate()
      .accounts({
        payer: bob.publicKey,
      })
      .transaction();

    const signature2 = await sendMagicTransaction(
      routerConnection,
      tx2,
      [bob]
    );

    console.log("✅ Undelegated Balances of Andy and Bob");
    console.log("Undelegation signatures:", signature1, signature2);
    // Naive wait for the transaction to be confirmed on the base chain. Better pattern incoming soon.
    await new Promise(resolve => setTimeout(resolve, 5000)); 
    await printBalances(program, andyBalancePda, bobBalancePda);
  });
});
