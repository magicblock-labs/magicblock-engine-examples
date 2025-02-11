import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Counter } from "../target/types/counter";
import { Increase } from "../target/types/increase";
import {
  InitializeNewWorld,
  AddEntity,
  InitializeComponent,
  ApplySystem,
  FindComponentPda,
  createUndelegateInstruction,
  createDelegateInstruction,
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/bolt-sdk";
import { expect } from "chai";

describe("BoltCounter", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const providerEphemeralRollup = new anchor.AnchorProvider(
      new anchor.web3.Connection(process.env.PROVIDER_ENDPOINT || "https://devnet.magicblock.app", {
        wsEndpoint: process.env.WS_ENDPOINT || "wss://devnet.magicblock.app",
      }),
      anchor.Wallet.local()
  );

  // Constants used to test the program.
  let worldPda: PublicKey;
  let entityPda: PublicKey;

  const counterComponent = anchor.workspace.Counter as Program<Counter>;
  const systemIncrease = anchor.workspace.Increase as Program<Increase>;

  it("InitializeNewWorld", async () => {
    const initNewWorld = await InitializeNewWorld({
      payer: provider.wallet.publicKey,
      connection: provider.connection,
    });
    const txSign = await provider.sendAndConfirm(initNewWorld.transaction);
    worldPda = initNewWorld.worldPda;
    console.log(
      `Initialized a new world (ID=${worldPda}). Initialization signature: ${txSign}`
    );
  });

  it("Add an entity", async () => {
    const addEntity = await AddEntity({
      payer: provider.wallet.publicKey,
      world: worldPda,
      connection: provider.connection,
    });
    const txSign = await provider.sendAndConfirm(addEntity.transaction);
    entityPda = addEntity.entityPda;
    console.log(
      `Initialized a new Entity (ID=${addEntity.entityPda}). Initialization signature: ${txSign}`
    );
  });

  it("Add a component", async () => {
    const initComponent = await InitializeComponent({
      payer: provider.wallet.publicKey,
      entity: entityPda,
      componentId: counterComponent.programId,
    });
    const txSign = await provider.sendAndConfirm(initComponent.transaction);
    console.log(
      `Initialized the grid component. Initialization signature: ${txSign}`
    );
  });

  it("Delegate a PDA", async () => {
    const counterPda = FindComponentPda({
        componentId: counterComponent.programId,
        entity: entityPda,
    });
    const delegateIx = createDelegateInstruction({
      entity: entityPda,
      account: counterPda,
      ownerProgram: counterComponent.programId,
      payer: provider.wallet.publicKey,
    });
    const tx = new anchor.web3.Transaction().add(delegateIx);
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (await provider.connection.getLatestBlockhash({commitment: "confirmed"})).blockhash;
    const txSign = await provider.sendAndConfirm(tx, [], {commitment: "confirmed", skipPreflight: true});
    console.log(`Delegate: ${txSign}`);
    const acc = await provider.connection.getAccountInfo(counterPda);
    expect(acc.owner.toBase58()).to.equal(DELEGATION_PROGRAM_ID.toBase58());
  });

  it("Apply the increase system", async () => {
    const applySystem = await ApplySystem({
      authority: providerEphemeralRollup.wallet.publicKey,
      world: worldPda,
      entities: [
        {
          entity: entityPda,
          components: [{ componentId: counterComponent.programId }],
        },
      ],
      systemId: systemIncrease.programId,
    });
    const tx = applySystem.transaction;
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
    const txSign = await providerEphemeralRollup.sendAndConfirm(tx, [], { skipPreflight: true });
    console.log(`Applied a system. Signature: ${txSign}`);
  });

  it("Undelegate the counter", async () => {
    const counterComponentPda = FindComponentPda({
      componentId: counterComponent.programId,
      entity: entityPda,
    });
    const undelegateIx = createUndelegateInstruction({
      payer: provider.wallet.publicKey,
      delegatedAccount: counterComponentPda,
      componentPda: counterComponent.programId,
    });
    let tx = new anchor.web3.Transaction()
        .add(undelegateIx);
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txSign = await providerEphemeralRollup.sendAndConfirm(tx, [], { skipPreflight: false });
    const acc = await providerEphemeralRollup.connection.getAccountInfo(
        counterComponentPda
    );
    console.log(`Undelegation signature: ${txSign}`);
    expect(acc.owner.toBase58()).to.equal(DELEGATION_PROGRAM_ID.toBase58());
  });
});