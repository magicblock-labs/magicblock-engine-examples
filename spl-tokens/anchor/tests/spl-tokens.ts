import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { MagicSVM } from "@magicblock-labs/magicsvm";
import {
  AccountLayout,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { assert } from "chai";
import {
  delegateSpl,
  deriveEphemeralAta,
  deriveRentPda,
  EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  transferSpl,
  undelegateIx,
  withdrawSpl,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  bootAnchorSvm,
  sendSvmTx,
  accountOwner,
} from "@magicblock-labs/test-utils";
import { SplTokens } from "../target/types/spl_tokens";

const MINT_SIZE = 82;
const TOKEN_AMOUNT = 1000n;

function tokenAmount(
  svm: MagicSVM,
  ata: PublicKey,
  target: "base" | "ephemeral",
): bigint {
  const account = svm.getAccountFor(ata, { target });
  if (!account.exists) {
    throw new Error(`missing token account ${ata.toBase58()} on ${target}`);
  }
  return AccountLayout.decode(Buffer.from(account.data)).amount;
}

describe("spl-tokens magicsvm", () => {
  const createHarness = () => {
    const {
      svm,
      payer: admin,
      program,
      validator,
    } = bootAnchorSvm<SplTokens>({
      fromDir: __dirname,
      programName: "spl_tokens",
      airdropLamports: BigInt(10 * LAMPORTS_PER_SOL),
    });
    return { admin, program, svm, validator: new PublicKey(validator) };
  };

  const setupMintWithRecipients = (
    svm: MagicSVM,
    admin: Keypair,
  ): {
    mint: Keypair;
    owners: [Keypair, Keypair];
    atas: [PublicKey, PublicKey];
  } => {
    const newMint = Keypair.generate();
    const owner1 = Keypair.generate();
    const owner2 = Keypair.generate();
    const [sponsorPda] = deriveRentPda();

    const fundTx = new Transaction();
    for (const r of [owner1.publicKey, owner2.publicKey, sponsorPda]) {
      fundTx.add(
        SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: r,
          lamports: 0.2 * LAMPORTS_PER_SOL,
        }),
      );
    }
    sendSvmTx(svm, [admin], fundTx, "base", "fund recipients");

    const ata1 = getAssociatedTokenAddressSync(
      newMint.publicKey,
      owner1.publicKey,
    );
    const ata2 = getAssociatedTokenAddressSync(
      newMint.publicKey,
      owner2.publicKey,
    );

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: newMint.publicKey,
        space: MINT_SIZE,
        lamports: Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        newMint.publicKey,
        0,
        admin.publicKey,
        null,
      ),
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        ata1,
        owner1.publicKey,
        newMint.publicKey,
      ),
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        ata2,
        owner2.publicKey,
        newMint.publicKey,
      ),
      createMintToInstruction(
        newMint.publicKey,
        ata1,
        admin.publicKey,
        TOKEN_AMOUNT,
      ),
      createMintToInstruction(
        newMint.publicKey,
        ata2,
        admin.publicKey,
        TOKEN_AMOUNT,
      ),
    );
    sendSvmTx(svm, [admin, newMint], tx, "base", "create mint and ATAs");

    const acct1 = tokenAmount(svm, ata1, "base");
    const acct2 = tokenAmount(svm, ata2, "base");
    if (acct1 !== TOKEN_AMOUNT) {
      throw new Error(`owner1 expected ${TOKEN_AMOUNT}, got ${acct1}`);
    }
    if (acct2 !== TOKEN_AMOUNT) {
      throw new Error(`owner2 expected ${TOKEN_AMOUNT}, got ${acct2}`);
    }

    return {
      mint: newMint,
      owners: [owner1, owner2],
      atas: [ata1, ata2],
    };
  };

  it("Delegate SPL tokens, do a transfer and undelegate", async () => {
    const { admin, svm, validator } = createHarness();
    console.log("spl-tokens.ts (magicsvm)");
    console.log("Validator: ", validator.toBase58());
    const {
      mint,
      owners: [recipientA, recipientB],
      atas: [ataA, ataB],
    } = setupMintWithRecipients(svm, admin);

    console.log("\nUser1: ", recipientA.publicKey.toBase58());
    console.log("User2: ", recipientB.publicKey.toBase58());

    assert(tokenAmount(svm, ataA, "base") == 1000n);
    assert(tokenAmount(svm, ataB, "base") == 1000n);

    const delegateOpts = {
      validator,
      idempotent: false as const,
      payer: admin.publicKey,
    };

    const delegations: [Keypair, bigint, boolean][] = [
      [recipientA, 50n, true],
      [recipientB, 10n, false],
    ];
    for (const [owner, amount, initVaultIfMissing] of delegations) {
      const ixs = await delegateSpl(owner.publicKey, mint.publicKey, amount, {
        ...delegateOpts,
        initVaultIfMissing,
      });
      sendSvmTx(
        svm,
        [admin, owner],
        new Transaction().add(...ixs),
        "base",
        `delegate ${owner.publicKey.toBase58()}`,
      );
    }

    const erAAfterDelegate = tokenAmount(svm, ataA, "ephemeral");
    const erBAfterDelegate = tokenAmount(svm, ataB, "ephemeral");
    assert(
      erAAfterDelegate == 50n,
      `A ER balance after delegate ${erAAfterDelegate}`,
    );
    assert(
      erBAfterDelegate == 10n,
      `B ER balance after delegate ${erBAfterDelegate}`,
    );

    const transferIxs = await transferSpl(
      recipientA.publicKey,
      recipientB.publicKey,
      mint.publicKey,
      2n,
      {
        visibility: "public",
        fromBalance: "ephemeral",
        toBalance: "ephemeral",
      },
    );
    sendSvmTx(
      svm,
      [recipientA],
      new Transaction().add(...transferIxs),
      "ephemeral",
      "ER transfer",
    );

    const acctA = tokenAmount(svm, ataA, "ephemeral");
    const acctB = tokenAmount(svm, ataB, "ephemeral");
    assert(acctA == 48n);
    assert(acctB == 12n);

    for (const owner of [recipientA, recipientB]) {
      sendSvmTx(
        svm,
        [owner],
        new Transaction().add(undelegateIx(owner.publicKey, mint.publicKey)),
        "ephemeral",
        `undelegate ${owner.publicKey.toBase58()}`,
      );
    }

    for (const owner of [recipientA, recipientB]) {
      const [eata] = deriveEphemeralAta(owner.publicKey, mint.publicKey);
      assert(
        accountOwner(svm, eata, "base") ===
          EPHEMERAL_SPL_TOKEN_PROGRAM_ID.toString(),
        `${eata.toBase58()} was not undelegated back to ESPL`,
      );
    }

    const withdrawIxs = [
      ...(await withdrawSpl(recipientA.publicKey, mint.publicKey, acctA, {
        idempotent: false,
      })),
      ...(await withdrawSpl(recipientB.publicKey, mint.publicKey, acctB, {
        idempotent: false,
      })),
    ];
    sendSvmTx(
      svm,
      [admin, recipientA, recipientB],
      new Transaction().add(...withdrawIxs),
      "base",
      "withdraw",
    );

    assert(tokenAmount(svm, ataA, "base") == 998n);
    assert(tokenAmount(svm, ataB, "base") == 1002n);
  });

  it("Delegate SPL tokens and do a transfer through a program", async () => {
    const { admin, program, svm, validator } = createHarness();
    const delegateOpts = {
      validator,
      idempotent: false as const,
      payer: admin.publicKey,
    };

    const {
      mint: mint2,
      owners: [sender, receiver],
      atas: [ataSender, ataReceiver],
    } = setupMintWithRecipients(svm, admin);

    const ixsSender = await delegateSpl(
      sender.publicKey,
      mint2.publicKey,
      10n,
      {
        ...delegateOpts,
        initVaultIfMissing: true,
      },
    );
    sendSvmTx(
      svm,
      [admin, sender],
      new Transaction().add(...ixsSender),
      "base",
      "delegate sender",
    );

    const ixsReceiver = await delegateSpl(
      receiver.publicKey,
      mint2.publicKey,
      10n,
      { ...delegateOpts, initVaultIfMissing: false },
    );
    sendSvmTx(
      svm,
      [admin, receiver],
      new Transaction().add(...ixsReceiver),
      "base",
      "delegate receiver",
    );

    const erSenderAfterDelegate = tokenAmount(svm, ataSender, "ephemeral");
    const erReceiverAfterDelegate = tokenAmount(svm, ataReceiver, "ephemeral");
    assert(
      erSenderAfterDelegate == 10n,
      `sender ER balance after delegate ${erSenderAfterDelegate}`,
    );
    assert(
      erReceiverAfterDelegate == 10n,
      `receiver ER balance after delegate ${erReceiverAfterDelegate}`,
    );

    const txT = await program.methods
      .transfer(new BN(2))
      .accounts({
        payer: sender.publicKey,
        from: ataSender,
        to: ataReceiver,
      })
      .transaction();
    sendSvmTx(svm, [sender], txT, "ephemeral", "program transfer");

    const erSender = tokenAmount(svm, ataSender, "ephemeral");
    const erReceiver = tokenAmount(svm, ataReceiver, "ephemeral");
    assert(erSender == 8n, `sender ER balance ${erSender}`);
    assert(erReceiver == 12n, `receiver ER balance ${erReceiver}`);
  });
});
