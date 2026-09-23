import { web3 } from "@coral-xyz/anchor";
import {
  accountOwner,
  bootAnchorSvm,
  isDelegated,
  readU64le,
  sendSvmTx,
  validatorRemainingAccount,
} from "@magicblock-labs/test-utils";
import assert from "assert";
import { PublicCounter } from "../target/types/public_counter";

const COUNTER_SEED = "counter";

describe("public-counter magicsvm", () => {
  const { svm, payer, program, validator } = bootAnchorSvm<PublicCounter>({
    fromDir: __dirname,
    programName: "public_counter",
    airdropLamports: BigInt(2 * web3.LAMPORTS_PER_SOL),
  });
  const [counterPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId,
  );

  console.log("Program ID: ", program.programId.toString());
  console.log("Counter PDA: ", counterPDA.toString());
  console.log("Validator identity: ", validator.toString());

  it("Initialize counter on Solana", async () => {
    const tx = await program.methods
      .initialize()
      .accounts({
        user: payer.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "base", "initialize");
    assert.equal(readU64le(svm, counterPDA, "base"), 0n);
  });

  it("Increase counter on Solana", async () => {
    const tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "base", "increment (base)");
    assert.equal(readU64le(svm, counterPDA, "base"), 1n);
  });

  it("Delegate counter to ER", async () => {
    const tx = await program.methods
      .delegate()
      .accounts({
        payer: payer.publicKey,
        pda: counterPDA,
      })
      .remainingAccounts([validatorRemainingAccount(svm)])
      .transaction();
    sendSvmTx(svm, [payer], tx, "base", "delegate");
    assert.ok(isDelegated(svm, counterPDA));
  });

  it("Increase counter on ER", async () => {
    const tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "ephemeral", "increment (ER)");
    assert.equal(readU64le(svm, counterPDA, "ephemeral"), 2n);
  });

  it("Commit counter state on ER to Solana", async () => {
    const tx = await program.methods
      .commit()
      .accounts({
        payer: payer.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "ephemeral", "commit");
    const committed = svm.getAccountFor(counterPDA, { target: "base" });
    assert.ok(committed.exists, "counter missing on base after commit");
    console.log(
      "base account after commit:",
      committed.programAddress.toString(),
      Buffer.from(committed.data).readBigUInt64LE(8).toString(),
    );
    assert.equal(readU64le(svm, counterPDA, "base"), 2n);
    assert.ok(isDelegated(svm, counterPDA));
  });

  it("Increase counter on ER and commit", async () => {
    const tx = await program.methods
      .incrementAndCommit()
      .accounts({
        payer: payer.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "ephemeral", "incrementAndCommit");
    assert.equal(readU64le(svm, counterPDA, "ephemeral"), 3n);
    assert.equal(readU64le(svm, counterPDA, "base"), 3n);
  });

  it("Increment and undelegate counter on ER to Solana", async () => {
    const tx = await program.methods
      .incrementAndUndelegate()
      .accounts({
        payer: payer.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "ephemeral", "incrementAndUndelegate");
    assert.equal(readU64le(svm, counterPDA, "base"), 4n);
    assert.equal(
      accountOwner(svm, counterPDA, "base"),
      program.programId.toString(),
    );
  });
});
