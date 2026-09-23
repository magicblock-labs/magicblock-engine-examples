import {
  bootAnchorSvm,
  EPHEMERAL_VAULT_ID,
  isDelegated,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  permissionPdaFromAccount,
  readU64le,
  sendSvmTx,
  validatorPubkey,
} from "@magicblock-labs/test-utils";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { PrivateCounter } from "../target/types/private_counter";

const COUNTER_SEED = "counter";

describe("private-counter magicsvm", () => {
  const { svm, payer, program } = bootAnchorSvm<PrivateCounter>({
    fromDir: __dirname,
    programName: "private_counter",
    airdropLamports: BigInt(2 * LAMPORTS_PER_SOL),
  });
  const [counterPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED), payer.publicKey.toBuffer()],
    program.programId,
  );
  const permissionPDA = permissionPdaFromAccount(counterPDA);

  console.log("Program ID: ", program.programId.toString());
  console.log("Counter PDA: ", counterPDA.toString());
  console.log("Permission PDA: ", permissionPDA.toString());
  console.log("Validator identity: ", validatorPubkey(svm).toString());

  it("Initialize counter on Solana", async () => {
    const tx = await program.methods
      .initialize()
      .accounts({
        authority: payer.publicKey,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "base");
    if (readU64le(svm, counterPDA, "base") !== 0n) {
      throw new Error("expected count 0 after initialize");
    }
  });

  it("Increase counter on Solana", async () => {
    const account = svm.getAccountFor(counterPDA, { target: "base" });
    if (
      !account.exists ||
      account.programAddress.toString() !== program.programId.toString()
    ) {
      throw new Error("counter is not owned by the program on the base layer");
    }
    const tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "base");
    if (readU64le(svm, counterPDA, "base") !== 1n) {
      throw new Error("expected count 1 after base increment");
    }
  });

  it("Delegate counter to ER", async () => {
    const tx = await program.methods
      .delegate()
      .accountsPartial({
        authority: payer.publicKey,
        counter: counterPDA,
        validator: new PublicKey(validatorPubkey(svm)),
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "base");
    if (!isDelegated(svm, counterPDA)) {
      throw new Error("counter is not delegated");
    }
    const delegated = svm.getAccountFor(counterPDA, { target: "ephemeral" });
    if (!delegated.exists) {
      throw new Error("delegated counter missing on ephemeral");
    }
  });

  it("Initialize ephemeral permission on ER", async () => {
    const permissionProgram = svm.getAccountFor(PERMISSION_PROGRAM_ID, {
      target: "ephemeral",
    });
    console.log(
      "Permission program on ephemeral:",
      permissionProgram.exists
        ? `exists executable=${permissionProgram.executable}`
        : "missing",
    );
    const tx = await program.methods
      .initPermission()
      .accountsPartial({
        authority: payer.publicKey,
        counter: counterPDA,
        permission: permissionPDA,
        magicProgram: MAGIC_PROGRAM_ID,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "ephemeral");
    const permission = svm.getAccountFor(permissionPDA, {
      target: "ephemeral",
    });
    if (!permission.exists) {
      throw new Error("permission PDA was not created on ephemeral");
    }
  });

  it("Increase counter on ER", async () => {
    const tx = await program.methods
      .increment()
      .accounts({
        counter: counterPDA,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "ephemeral");
    if (readU64le(svm, counterPDA, "ephemeral") !== 2n) {
      throw new Error("expected count 2 after ER increment");
    }
  });

  it("Toggle privacy on ER (private -> public)", async () => {
    for (const isPrivate of [true, false]) {
      const tx = await program.methods
        .setPrivacy(isPrivate)
        .accountsPartial({
          counter: counterPDA,
          authority: payer.publicKey,
          permission: permissionPDA,
          magicProgram: MAGIC_PROGRAM_ID,
          permissionProgram: PERMISSION_PROGRAM_ID,
          ephemeralVault: EPHEMERAL_VAULT_ID,
        })
        .transaction();
      sendSvmTx(svm, [payer], tx, "ephemeral");
    }
  });

  it("Close permission on ER", async () => {
    const tx = await program.methods
      .closePermission()
      .accountsPartial({
        counter: counterPDA,
        authority: payer.publicKey,
        permission: permissionPDA,
        magicProgram: MAGIC_PROGRAM_ID,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "ephemeral");
  });

  it("Commit counter state on ER to Solana", async () => {
    const tx = await program.methods
      .commit()
      .accountsPartial({
        payer: payer.publicKey,
        counter: counterPDA,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "ephemeral");
    if (readU64le(svm, counterPDA, "base") !== 2n) {
      throw new Error("expected committed count 2 on base");
    }
  });

  it("Undelegate counter from ER to Solana", async () => {
    const tx = await program.methods
      .undelegate()
      .accountsPartial({
        payer: payer.publicKey,
        counter: counterPDA,
      })
      .transaction();
    sendSvmTx(svm, [payer], tx, "ephemeral");
    const account = svm.getAccountFor(counterPDA, { target: "base" });
    if (
      !account.exists ||
      account.programAddress.toString() !== program.programId.toString()
    ) {
      throw new Error("counter undelegation failed");
    }
    if (readU64le(svm, counterPDA, "base") !== 2n) {
      throw new Error("expected count 2 after undelegate");
    }
  });
});
