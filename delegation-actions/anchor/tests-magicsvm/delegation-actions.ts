import { web3 } from "@coral-xyz/anchor";
import {
  bootAnchorSvm,
  isDelegated,
  sendSvmTx,
  validatorRemainingAccount,
} from "@magicblock-labs/test-utils";
import { assert } from "chai";
import { DelegationActions } from "../target/types/delegation_actions";

const COUNTER_SEED = "counter";
const LAMPORTS_PER_SOL = 1_000_000_000n;

describe("delegation-actions-magicsvm", () => {
  const { svm, payer, program, validator } = bootAnchorSvm<DelegationActions>({
    fromDir: __dirname,
    programName: "delegation_actions",
    airdropLamports: 2n * LAMPORTS_PER_SOL,
  });
  const [pda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId,
  );

  console.log("Program ID: ", program.programId.toBase58());
  console.log("Counter PDA: ", pda.toBase58());
  console.log("Validator identity: ", validator.toString());

  function getCounter(target: "base" | "ephemeral"): number | null {
    const info = svm.getAccountFor(pda, { target });
    if (!info.exists) return null;
    return Number(Buffer.from(info.data).readBigUInt64LE(8));
  }

  function printCounter(message: string) {
    const delegated = isDelegated(svm, pda);
    let counterBase = "<n/a>";
    let counterER = "<n/a>";
    if (delegated) {
      counterBase = "<Delegated>";
      counterER = getCounter("ephemeral")?.toString() ?? "<n/a>";
    } else {
      counterBase = getCounter("base")?.toString() ?? "<n/a>";
      counterER = "<Not Delegated>";
    }
    console.log("--------------------------------");
    console.log(`| ${delegated ? "✅ Delegated" : "❌ Not Delegated"}`);
    console.log("--------------------------------");
    console.log("| Counter (Base): ", counterBase);
    console.log("| Counter (ER):   ", counterER);
    console.log("--------------------------------");
    console.log(message);
  }

  it("Initialize Counter", async () => {
    sendSvmTx(
      svm,
      [payer],
      await program.methods
        .initialize()
        .accounts({
          counter: pda,
          user: payer.publicKey,
          systemProgram: web3.SystemProgram.programId,
        } as any)
        .transaction(),
      "base",
    );
    printCounter("✅ Initialized");
    assert.equal(getCounter("base"), 0);
  });

  it("Increment Counter on base layer", async () => {
    sendSvmTx(
      svm,
      [payer],
      await program.methods
        .increment()
        .accounts({ counter: pda })
        .transaction(),
      "base",
    );
    printCounter("Counter incremented on base layer");
    assert.equal(getCounter("base"), 1);
  });

  it("Delegate Counter with a post-delegation action", async () => {
    const before = getCounter("base");
    assert.isNotNull(before);

    // `delegate_with_actions` delegates the counter AND attaches an `increment`
    // action. MagicSVM should run that action automatically once the account is
    // delegated — no separate increment transaction is sent here.
    sendSvmTx(
      svm,
      [payer],
      await program.methods
        .delegateWithActions()
        .accounts({ payer: payer.publicKey, pda })
        .remainingAccounts([validatorRemainingAccount(svm)])
        .transaction(),
      "base",
    );

    const after = getCounter("ephemeral");
    printCounter(
      `Post-delegation action result — ER counter: ${after} (was ${before})`,
    );

    if (after !== before! + 1) {
      throw new Error(
        `Post-delegation action did not run: expected ${
          before! + 1
        } in ER, got ${after}`,
      );
    }
    console.log("✅ Post-delegation action executed automatically in the ER");
    assert.isTrue(isDelegated(svm, pda));
  });

  it("Increment Counter in ER", async () => {
    assert.isTrue(isDelegated(svm, pda));
    const before = getCounter("ephemeral");
    sendSvmTx(
      svm,
      [payer],
      await program.methods
        .increment()
        .accounts({ counter: pda })
        .transaction(),
      "ephemeral",
    );
    printCounter("✅ Incremented (ER)");
    assert.equal(getCounter("ephemeral"), (before ?? 0) + 1);
  });

  it("Undelegate Counter", async () => {
    assert.isTrue(isDelegated(svm, pda));
    sendSvmTx(
      svm,
      [payer],
      await program.methods
        .undelegate()
        .accounts({ payer: payer.publicKey })
        .transaction(),
      "ephemeral",
    );
    printCounter("✅ Undelegated");
    assert.isFalse(isDelegated(svm, pda));
  });
});
