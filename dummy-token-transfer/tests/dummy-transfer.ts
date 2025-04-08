import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import { DummyTransfer } from "../target/types/dummy_transfer";
import {
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";

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

  const bob = web3.Keypair.fromSecretKey(
    Uint8Array.from(
      require("./fixtures/BobA5Fqyr3Yh8ie4eqCGFS9nwB1rmJhfTA8Hmtb2ifU.json")
    )
  );
  const fred = web3.Keypair.fromSecretKey(
    Uint8Array.from(
      require("./fixtures/FredtxoSVLjNR6h4w5DovxfTxUAfQwK4xsrR6Vhm1Gqt.json")
    )
  );

  const ronBalancePda = web3.PublicKey.findProgramAddressSync(
    [provider.wallet.publicKey.toBuffer()],
    program.programId
  )[0];

  const bobBalancePda = web3.PublicKey.findProgramAddressSync(
    [bob.publicKey.toBuffer()],
    program.programId
  )[0];

  const fredBalancePda = web3.PublicKey.findProgramAddressSync(
    [fred.publicKey.toBuffer()],
    program.programId
  )[0];

  before(async () => {
    if (
      provider.connection.rpcEndpoint.includes("localhost") ||
      provider.connection.rpcEndpoint.includes("127.0.0.1")
    ) {
      // Airdrop to bob
      const bobAirdropSignature = await provider.connection.requestAirdrop(
        bob.publicKey,
        2 * web3.LAMPORTS_PER_SOL
      );

      // Airdrop to fred
      const fredAirdropSignature = await provider.connection.requestAirdrop(
        fred.publicKey,
        2 * web3.LAMPORTS_PER_SOL
      );
    }
  });

  it("Initializes the balance if it is not already initialized.", async () => {
    const balanceAccountInfo = await provider.connection.getAccountInfo(
      ronBalancePda
    );

    if (balanceAccountInfo === null) {
      const tx = await program.methods
        .initialize()
        .accounts({
          user: provider.wallet.publicKey,
        })
        .rpc({skipPreflight: true});
      console.log("Init Balance Tx: ", tx);
    }

    const balanceAccount = await program.account.balance.fetch(ronBalancePda);
    console.log("Balance: ", balanceAccount.balance.toString());
  });

  it("Transfer from Ron to Bob and Fred", async () => {
    const balanceAccountInfo = await provider.connection.getAccountInfo(
        ronBalancePda
    );
    if (
        balanceAccountInfo.owner.toBase58() == DELEGATION_PROGRAM_ID.toBase58()
    ) {
      console.log("Balances is are delegated");
      return;
    }
    const tx = await program.methods
      .transfer(new BN(1))
      .accounts({
        payer: provider.wallet.publicKey,
        receiver: bob.publicKey,
      })
      .postInstructions([
        await program.methods
          .transfer(new BN(2))
          .accounts({
            payer: provider.wallet.publicKey,
            receiver: fred.publicKey,
          })
          .instruction(),
      ])
      .rpc({skipPreflight: true});
    console.log("Transfer Tx: ", tx);

    let balanceAccount = await program.account.balance.fetch(ronBalancePda);
    console.log("Balance Ron: ", balanceAccount.balance.toString());
    balanceAccount = await program.account.balance.fetch(bobBalancePda);
    console.log("Balance Bob: ", balanceAccount.balance.toString());
    balanceAccount = await program.account.balance.fetch(fredBalancePda);
    console.log("Balance Fred: ", balanceAccount.balance.toString());
  });

  it("Delegate Balances of Ron, Bob and Fred", async () => {
    const balanceAccountInfo = await provider.connection.getAccountInfo(
      ronBalancePda
    );
    if (
      balanceAccountInfo.owner.toBase58() == DELEGATION_PROGRAM_ID.toBase58()
    ) {
      console.log("Balance is already delegated");
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
          .instruction(),
        await program.methods
            .delegate()
            .accounts({
              payer: fred.publicKey,
            })
            .instruction(),
      ])
      .signers([bob, fred])
      .rpc( {commitment: "confirmed", skipPreflight: true});

    console.log("Delegation signature", tx);
  });

  it("Perform transfers in the ephemeral rollup", async () => {
    let tx = await ephemeralProgram.methods
        .transfer(new BN(1))
        .accounts({
          payer: provider.wallet.publicKey,
          receiver: bob.publicKey,
        })
        .postInstructions([
          await ephemeralProgram.methods
              .transfer(new BN(1))
              .accounts({
                payer: provider.wallet.publicKey,
                receiver: fred.publicKey,
              })
              .instruction(),
        ])
        .rpc({skipPreflight: true});
    console.log("Transfer Tx: ", tx);

    let balanceAccount = await ephemeralProgram.account.balance.fetch(ronBalancePda);
    console.log("Balance Ron: ", balanceAccount.balance.toString());
    balanceAccount = await ephemeralProgram.account.balance.fetch(bobBalancePda);
    console.log("Balance Bob: ", balanceAccount.balance.toString());
    balanceAccount = await ephemeralProgram.account.balance.fetch(fredBalancePda);
    console.log("Balance Fred: ", balanceAccount.balance.toString());
  });

  it("Undelegate Balances of Ron, Bob and Fred", async () => {
    const balanceAccountInfo = await provider.connection.getAccountInfo(
      ronBalancePda
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
        await program.methods
            .undelegate()
            .accounts({
              payer: fred.publicKey,
            })
            .instruction(),
      ])
      .signers([bob, fred])
      .rpc({skipPreflight: true});
  });

});
