import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import { DummyTransfer } from "../target/types/dummy_transfer";
import {
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { select } from "firebase-functions/params";

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

  // Configure the ephemeral rollup endpoint.
  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.PROVIDER_ENDPOINT || "https://devnet.magicblock.app/",
      {
        wsEndpoint: process.env.WS_ENDPOINT || "wss://devnet.magicblock.app/",
      }
    ),
    anchor.Wallet.local()
  );

  console.log("Provider Endpoint: ", providerEphemeralRollup.connection._rpcEndpoint)
  console.log("Provider WS Endpoint: ", providerEphemeralRollup.connection._rpcWsEndpoint)

  const program = anchor.workspace.DummyTransfer as Program<DummyTransfer>;
  const ephemeralProgram = new Program(program.idl, providerEphemeralRollup);

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

    if (!andyBalancePDA) {
      await program.methods
        .initialize()
        .accounts({
          user: provider.wallet.publicKey,
        })
        .rpc({ skipPreflight: true });
    } else {
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
      await provider.sendAndConfirm(tx, [bob]);
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
      .rpc({ skipPreflight: true });
    console.log("✅ Transfered 5 from Andy to Bob");
    console.log("Transfer Tx: ", tx);

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
    let tx = await program.methods
      .delegate()
      .accounts({
        payer: provider.wallet.publicKey,
      })
      .postInstructions([
        await program.methods
          .delegate()
          .accounts({
            payer: bob.publicKey,
          })
          .instruction()
      ])
      .signers([bob])
      .rpc( {commitment: "confirmed", skipPreflight: true});

    console.log("✅ Delegated Balances of Andy and Bob");
    console.log("Delegation signature", tx);
  });

  it("Perform transfers in the ephemeral rollup", async () => {
    let tx = await ephemeralProgram.methods
        .transfer(new BN(5))
        .accounts({
          payer: provider.wallet.publicKey,
          receiver: bob.publicKey,
        })
      .rpc({skipPreflight: true});
    console.log("✅ Transfered 5 from Andy to Bob in the ephemeral rollup");
    console.log("Transfer Tx: ", tx);


    let tx2 = await ephemeralProgram.methods
        .transfer(new BN(15))
        .accounts({
          payer: bob.publicKey,
          receiver: provider.wallet.publicKey,
        })
      .signers([bob])
      .rpc({skipPreflight: true});
    console.log("✅ Transfered 15 from Bob to Andy in the ephemeral rollup");
    console.log("Transfer Tx: ", tx2);
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
    let tx = await ephemeralProgram.methods
      .undelegate()
      .accounts({
        payer: provider.wallet.publicKey,
      })
      .postInstructions([
        await program.methods
          .undelegate()
          .accounts({
            payer: bob.publicKey,
          })
          .instruction(),
      ])
      .signers([bob])
      .rpc({skipPreflight: true});
    
    console.log("✅ Undelegated Balances of Andy and Bob");
    // We wait here for the transaction to be confirmed on the base chain
    await new Promise(resolve => setTimeout(resolve, 5000));
    await printBalances(program, andyBalancePda, bobBalancePda);
  });  
});
