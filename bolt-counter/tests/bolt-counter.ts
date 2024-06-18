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
  createDelegateInstruction,
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/bolt-sdk";
import { expect } from "chai";
import {createUndelegateInstruction} from "@magicblock-labs/bolt-sdk/lib/delegation/undelegate";

describe("BoltCounter", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const providerEphemeralRollup = new anchor.AnchorProvider(
      new anchor.web3.Connection(process.env.PROVIDER_ENDPOINT, {
        wsEndpoint: process.env.WS_ENDPOINT,
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
      `Initialized a new Entity (ID=${addEntity.entityId}). Initialization signature: ${txSign}`
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
    const counterPda = FindComponentPda(counterComponent.programId, entityPda);
    const delegateIx = createDelegateInstruction({
      entity: entityPda,
      account: counterPda,
      ownerProgram: counterComponent.programId,
      payer: provider.wallet.publicKey,
    });
    const tx = new anchor.web3.Transaction().add(delegateIx);
    const txSign = await provider.sendAndConfirm(tx, [], { skipPreflight: true });
    console.log(
        `Delegation signature: ${txSign}`
    );
    const acc = await provider.connection.getAccountInfo(counterPda);
    expect(acc.owner.toString()).to.equal(DELEGATION_PROGRAM_ID);
  });

  it("Apply the increase system", async () => {
    await delay(15000);
    const applySystem = await ApplySystem({
      authority: providerEphemeralRollup.wallet.publicKey,
      system: systemIncrease.programId,
      entity: entityPda,
      components: [counterComponent.programId],
    });
    const txSign = await providerEphemeralRollup.sendAndConfirm(applySystem.transaction);
    console.log(`Applied a system. Signature: ${txSign}`);
  });

  it("Undelegate the counter", async () => {
    await delay(10000);
    const counterComponentPda = FindComponentPda(
        counterComponent.programId,
        entityPda
    );
    const undelegateIx = createUndelegateInstruction({
      payer: provider.wallet.publicKey,
      delegatedAccount: counterComponentPda,
      ownerProgram: counterComponent.programId,
      reimbursement: provider.wallet.publicKey,
    });
    const tx = new anchor.web3.Transaction().add(undelegateIx);
    await provider.sendAndConfirm(tx, [], { skipPreflight: true });
    const acc = await provider.connection.getAccountInfo(
        counterComponentPda
    );
    expect(acc.owner).to.deep.equal(counterComponent.programId);
  });

});

function delay(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}
