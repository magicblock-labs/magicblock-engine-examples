import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { PublicCounter } from "../target/types/public_counter";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { homedir } from "os";
import { MagicSVM, TransactionMetadata } from "@magicblock-labs/magicsvm";
import { transaction } from "test-utils";
import { expect } from "chai";

const COUNTER_SEED = "counter";
const keypairPath = path.join("target/deploy/public_counter-keypair.json");
const programSoPath = path.join("target/deploy/public_counter.so");
const idlPath = path.join("target/idl/public_counter.json");
const walletPath =
  process.env.ANCHOR_WALLET ?? path.join(homedir(), ".config/solana/id.json");

const user = web3.Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))),
);

describe("magicsvm-counter", () => {
  const svm = new MagicSVM().withSysvars().withBuiltins().withDefaultPrograms();
  const programId = web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))),
  ).publicKey;
  svm.addProgram(
    programId.toBase58(),
    new Uint8Array(fs.readFileSync(programSoPath)),
  );

  const provider = new anchor.AnchorProvider(
    new web3.Connection("http://127.0.0.1:8899"),
    new anchor.Wallet(user),
    { commitment: "confirmed" },
  );
  const program = new Program(
    JSON.parse(fs.readFileSync(idlPath, "utf8")) as PublicCounter,
    provider,
  );

  before(async function () {
    svm.airdrop(user.publicKey.toBase58(), BigInt(LAMPORTS_PER_SOL));
  });

  const [counterPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId,
  );

  console.log("Program ID: ", program.programId.toString());
  console.log("Counter PDA: ", counterPDA.toString());

  it("Initialize counter on Solana", async () => {
    let tx = await program.methods
      .initialize()
      .accounts({
        user: user.publicKey,
      })
      .transaction();
    tx.feePayer = user.publicKey;
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(user);
    const result = svm.sendTransaction(transaction(tx));
    expect(result instanceof TransactionMetadata).to.be.true;

    const counterAccount = svm.getAccount(counterPDA.toBase58());
    if (!counterAccount.exists) {
      throw new Error("Counter account does not exist");
    }

    expect(Buffer.from(counterAccount.data).readBigUInt64LE(8)).to.be.equal(0n);
  });

  it("Increase counter on Solana", async () => {
    let tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
      })
      .transaction();
    tx.feePayer = user.publicKey;
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(user);
    const result = svm.sendTransaction(transaction(tx));
    expect(result instanceof TransactionMetadata).to.be.true;

    const counterAccount = svm.getAccount(counterPDA.toBase58());
    if (!counterAccount.exists) {
      throw new Error("Counter account does not exist");
    }

    expect(Buffer.from(counterAccount.data).readBigUInt64LE(8)).to.be.equal(1n);
  });

  it("Delegate counter to ER", async () => {
    let tx = await program.methods
      .delegate()
      .accounts({
        payer: user.publicKey,
        pda: counterPDA,
      })
      .remainingAccounts([
        {
          pubkey: new web3.PublicKey(svm.validatorIdentity().toString()),
          isSigner: false,
          isWritable: false,
        },
      ])
      .transaction();
    tx.feePayer = user.publicKey;
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(user);
    const result = svm.sendTransaction(transaction(tx));
    expect(result instanceof TransactionMetadata).to.be.true;
  });

  it("Increase counter on ER", async () => {
    let tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
      })
      .transaction();
    tx.feePayer = user.publicKey;
    tx.recentBlockhash = svm.latestBlockhashFor({ target: "ephemeral" });
    tx.sign(user);
    const result = svm.sendTransaction(transaction(tx), {
      target: "ephemeral",
    });
    expect(result instanceof TransactionMetadata).to.be.true;

    const counterAccount = svm.getAccountFor(counterPDA.toBase58(), {
      target: "ephemeral",
    });
    if (!counterAccount.exists) {
      throw new Error("Counter account does not exist");
    }

    expect(Buffer.from(counterAccount.data).readBigUInt64LE(8)).to.be.equal(2n);
  });

  it("Commit counter state on ER to Solana", async () => {
    let tx = await program.methods
      .commit()
      .accounts({
        payer: user.publicKey,
      })
      .transaction();
    tx.feePayer = user.publicKey;
    tx.recentBlockhash = svm.latestBlockhashFor({ target: "ephemeral" });
    tx.sign(user);
    const result = svm.sendTransaction(transaction(tx), {
      target: "ephemeral",
    });
    expect(result instanceof TransactionMetadata).to.be.true;

    const counterAccount = svm.getAccount(counterPDA.toBase58());
    if (!counterAccount.exists) {
      throw new Error("Counter account does not exist");
    }

    expect(Buffer.from(counterAccount.data).readBigUInt64LE(8)).to.be.equal(2n);
  });

  it("Increase counter on ER and commit", async () => {
    let tx = await program.methods
      .incrementAndCommit()
      .accounts({
        payer: user.publicKey,
      })
      .transaction();
    tx.feePayer = user.publicKey;
    tx.recentBlockhash = svm.latestBlockhashFor({ target: "ephemeral" });
    tx.sign(user);
    const result = svm.sendTransaction(transaction(tx), {
      target: "ephemeral",
    });
    expect(result instanceof TransactionMetadata).to.be.true;

    const counterAccount = svm.getAccount(counterPDA.toBase58());
    if (!counterAccount.exists) {
      throw new Error("Counter account does not exist");
    }

    expect(Buffer.from(counterAccount.data).readBigUInt64LE(8)).to.be.equal(3n);
  });

  it("Increment and undelegate counter on ER to Solana", async () => {
    let tx = await program.methods
      .incrementAndUndelegate()
      .accounts({
        payer: user.publicKey,
      })
      .transaction();
    tx.feePayer = user.publicKey;
    tx.recentBlockhash = svm.latestBlockhashFor({ target: "ephemeral" });
    tx.sign(user);
    const result = svm.sendTransaction(transaction(tx), {
      target: "ephemeral",
    });
    expect(result instanceof TransactionMetadata).to.be.true;

    const counterAccount = svm.getAccount(counterPDA.toBase58());
    if (!counterAccount.exists) {
      throw new Error("Counter account does not exist");
    }

    expect(Buffer.from(counterAccount.data).readBigUInt64LE(8)).to.be.equal(4n);
  });
});
