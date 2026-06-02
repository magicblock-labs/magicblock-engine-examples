import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import { DummyTransfer } from "../target/types/dummy_transfer";
import {
  keypairToMagicSigner,
  publicKeyToMagicAddress,
  transactionToMagicTransaction,
} from "test-utils";
import {
  FailedTransactionMetadata,
  MagicSVM,
  TransactionMetadata,
  TransactionTarget,
} from "@magicblock-labs/magicsvm";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

const program = anchor.workspace.DummyTransfer as Program<DummyTransfer>;
const programBytes = fs.readFileSync(
  path.join(__dirname, "../target/deploy/dummy_transfer.so")
);
const programId = publicKeyToMagicAddress(program.programId);

type ExpectedBalances = { andy: string | null; bob: string | null };

function expectSuccess(meta: TransactionMetadata | FailedTransactionMetadata) {
  if (meta instanceof FailedTransactionMetadata) {
    console.error("❌ Failed to execute transaction", meta.toString());
    console.error("Transaction logs: ", meta.meta().prettyLogs());
    throw new Error("Failed to execute transaction");
  } else if (meta instanceof TransactionMetadata) {
    console.log("✅ Transaction executed successfully");
  } else {
    throw new Error("Invalid signature");
  }
  return meta;
}

function getBalance(
  svm: MagicSVM,
  balancePda: web3.PublicKey,
  layer: TransactionTarget
): string | null {
  try {
    const accountData = svm.getAccountFor(publicKeyToMagicAddress(balancePda), {
      target: layer,
    });
    if (!accountData.exists) {
      return null;
    }

    const account = program.coder.accounts.decode(
      "balance",
      Buffer.from(accountData.data)
    );
    return account.balance.toString();
  } catch (e) {
    return null;
  }
}

function getBalances(
  svm: MagicSVM,
  andyBalancePda: web3.PublicKey,
  bobBalancePda: web3.PublicKey,
  layer: TransactionTarget
): ExpectedBalances {
  return {
    andy: getBalance(svm, andyBalancePda, layer),
    bob: getBalance(svm, bobBalancePda, layer),
  };
}

function printBalances(
  svm: MagicSVM,
  andyBalancePda: web3.PublicKey,
  bobBalancePda: web3.PublicKey,
  layer: TransactionTarget
) {
  const balances = getBalances(svm, andyBalancePda, bobBalancePda, layer);

  if (balances.andy !== null) {
    console.log(
      `${layer === "ephemeral" ? "Ephemeral" : "Base"} Andy Balance: ${balances.andy
      }`
    );
  } else {
    console.log("Andy Balance PDA not initialized");
  }
  if (balances.bob !== null) {
    console.log(
      `${layer === "ephemeral" ? "Ephemeral" : "Base"} Bob Balance: ${balances.bob
      }`
    );
  } else {
    console.log("Bob Balance PDA not initialized");
  }
}

function expectBalances(
  svm: MagicSVM,
  andyBalancePda: web3.PublicKey,
  bobBalancePda: web3.PublicKey,
  layer: TransactionTarget,
  expected: ExpectedBalances
) {
  const balances = getBalances(svm, andyBalancePda, bobBalancePda, layer);
  expect(balances).to.deep.equal(expected);
}

describe("dummy-transfer", () => {
  let svm = new MagicSVM();

  const andy = web3.Keypair.generate();
  const bob = web3.Keypair.generate();
  const andySigner = keypairToMagicSigner(andy);
  const bobSigner = keypairToMagicSigner(bob);

  const andyBalancePda = web3.PublicKey.findProgramAddressSync(
    [andy.publicKey.toBuffer()],
    program.programId
  )[0];
  const bobBalancePda = web3.PublicKey.findProgramAddressSync(
    [bob.publicKey.toBuffer()],
    program.programId
  )[0];

  console.log("Program ID: ", program.programId.toBase58());
  console.log("Andy Public Key: ", andy.publicKey.toBase58());
  console.log("Bob Public Key: ", bob.publicKey.toBase58());
  console.log("Andy Balance PDA: ", andyBalancePda.toBase58());
  console.log("Bob Balance PDA: ", bobBalancePda.toBase58());

  before(() => {
    svm.addProgram(programId, programBytes);

    // Airdrop to keypairs
    const andyAirdropSignature = svm.airdrop(
      publicKeyToMagicAddress(andy.publicKey),
      BigInt(2 * web3.LAMPORTS_PER_SOL)
    );
    expectSuccess(andyAirdropSignature);
    const bobAirdropSignature = svm.airdrop(
      publicKeyToMagicAddress(bob.publicKey),
      BigInt(2 * web3.LAMPORTS_PER_SOL)
    );
    expectSuccess(bobAirdropSignature);
  });

  it("Initialize balances", async () => {
    const andyInitializeTx = await transactionToMagicTransaction(
      await program.methods
        .initialize()
        .accountsPartial({
          user: andy.publicKey,
        })
        .transaction(),
      {
        recentBlockhash: svm.latestBlockhash(),
        payer: andySigner,
      }
    );
    const andyInitializeSignature = svm.sendTransaction(andyInitializeTx);
    expectSuccess(andyInitializeSignature);
    console.log("✅ Initialized Andy Balance PDA!");

    const bobInitializeTx = await transactionToMagicTransaction(
      await program.methods
        .initialize()
        .accounts({
          user: bob.publicKey,
        })
        .transaction(),
      {
        recentBlockhash: svm.latestBlockhash(),
        payer: bobSigner,
      }
    );
    const bobInitializeSignature = svm.sendTransaction(bobInitializeTx);
    expectSuccess(bobInitializeSignature);
    console.log("✅ Initialized Bob Balance PDA!");

    printBalances(svm, andyBalancePda, bobBalancePda, "base");
    printBalances(svm, andyBalancePda, bobBalancePda, "ephemeral");
    expectBalances(svm, andyBalancePda, bobBalancePda, "base", {
      andy: "100",
      bob: "100",
    });
    expectBalances(svm, andyBalancePda, bobBalancePda, "ephemeral", {
      andy: "100",
      bob: "100",
    });
  });

  it("Transfer on base chain from Andy to Bob", async () => {
    const tx = await transactionToMagicTransaction(
      await program.methods
        .transfer(new BN(5))
        .accounts({
          payer: andy.publicKey,
          receiver: bob.publicKey,
        })
        .transaction(),
      {
        recentBlockhash: svm.latestBlockhash(),
        payer: andySigner,
      }
    );
    const signature = svm.sendTransaction(tx);
    expectSuccess(signature);
    console.log("✅ Transfered 5 from Andy to Bob!");

    printBalances(svm, andyBalancePda, bobBalancePda, "base");
    printBalances(svm, andyBalancePda, bobBalancePda, "ephemeral");
    expectBalances(svm, andyBalancePda, bobBalancePda, "base", {
      andy: "95",
      bob: "105",
    });
    expectBalances(svm, andyBalancePda, bobBalancePda, "ephemeral", {
      andy: "95",
      bob: "105",
    });
  });

  it("Delegate Balances of Andy and Bob", async () => {
    const validator = new web3.PublicKey(svm.validatorIdentity().toString());
    const tx = await transactionToMagicTransaction(
      await program.methods
        .delegate({
          commitFrequencyMs: 30000,
          validator,
        })
        .accounts({
          payer: andy.publicKey,
        })
        .postInstructions([
          await program.methods
            .delegate({
              commitFrequencyMs: 30000,
              validator,
            })
            .accounts({
              payer: bob.publicKey,
            })
            .instruction(),
        ])
        .transaction(),
      {
        recentBlockhash: svm.latestBlockhash(),
        payer: andySigner,
        signers: [bobSigner],
      }
    );
    const signature = svm.sendTransaction(tx);
    expectSuccess(signature);
    console.log("✅ Delegated Balances of Andy and Bob");
    printBalances(svm, andyBalancePda, bobBalancePda, "base");
    printBalances(svm, andyBalancePda, bobBalancePda, "ephemeral");
    expectBalances(svm, andyBalancePda, bobBalancePda, "base", {
      andy: "95",
      bob: "105",
    });
    expectBalances(svm, andyBalancePda, bobBalancePda, "ephemeral", {
      andy: "95",
      bob: "105",
    });
  });

  it("Perform transfers in the ephemeral rollup", async () => {
    const tx1 = await transactionToMagicTransaction(
      await program.methods
        .transfer(new BN(5))
        .accounts({
          payer: andy.publicKey,
          receiver: bob.publicKey,
        })
        .transaction(),
      {
        recentBlockhash: svm.latestBlockhash(),
        payer: andySigner,
      }
    );
    const signature1 = svm.sendTransaction(tx1, { target: "ephemeral" });
    expectSuccess(signature1);
    console.log("✅ Transfered 5 from Andy to Bob in the ephemeral rollup");

    const tx2 = await transactionToMagicTransaction(
      await program.methods
        .transfer(new BN(15))
        .accounts({
          payer: bob.publicKey,
          receiver: andy.publicKey,
        })
        .transaction(),
      {
        recentBlockhash: svm.latestBlockhash(),
        payer: bobSigner,
      }
    );
    const signature2 = svm.sendTransaction(tx2, { target: "ephemeral" });
    expectSuccess(signature2);
    console.log("✅ Transfered 15 from Bob to Andy in the ephemeral rollup");

    printBalances(svm, andyBalancePda, bobBalancePda, "ephemeral");
    printBalances(svm, andyBalancePda, bobBalancePda, "base");
    expectBalances(svm, andyBalancePda, bobBalancePda, "ephemeral", {
      andy: "105",
      bob: "95",
    });
    expectBalances(svm, andyBalancePda, bobBalancePda, "base", {
      andy: "95",
      bob: "105",
    });
  });

  it("Undelegate Balances of Andy and Bob", async () => {
    const tx1 = await transactionToMagicTransaction(
      await program.methods
        .undelegate()
        .accounts({
          payer: andy.publicKey,
        })
        .transaction(),
      {
        recentBlockhash: svm.latestBlockhash(),
        payer: andySigner,
      }
    );
    const signature1 = svm.sendTransaction(tx1, { target: "ephemeral" });
    expectSuccess(signature1);

    const tx2 = await transactionToMagicTransaction(
      await program.methods
        .undelegate()
        .accounts({
          payer: bob.publicKey,
        })
        .transaction(),
      {
        recentBlockhash: svm.latestBlockhash(),
        payer: bobSigner,
      }
    );
    const signature2 = svm.sendTransaction(tx2, { target: "ephemeral" });
    expectSuccess(signature2);

    console.log("✅ Undelegated Balances of Andy and Bob");

    printBalances(svm, andyBalancePda, bobBalancePda, "base");
    printBalances(svm, andyBalancePda, bobBalancePda, "ephemeral");
    expectBalances(svm, andyBalancePda, bobBalancePda, "base", {
      andy: "105",
      bob: "95",
    });
    expectBalances(svm, andyBalancePda, bobBalancePda, "ephemeral", {
      andy: "105",
      bob: "95",
    });
  });
});
