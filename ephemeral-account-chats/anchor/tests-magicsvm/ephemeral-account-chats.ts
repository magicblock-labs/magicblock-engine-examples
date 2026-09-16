import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  airdropOrThrow,
  bootAnchorSvm,
  DELEGATION_PROGRAM_ID,
  requireAccount,
  sendExpectingFailure,
  sendSvmIx,
} from "@magicblock-labs/test-utils";
import { EphemeralAccountChats } from "../target/types/ephemeral_account_chats";

function generateName(): string {
  const randomNumber = Math.floor(Math.random() * 10000000000);
  return randomNumber.toString().padStart(10, "0");
}

function conversationSize(messageCount: number): number {
  return 8 + 1 + 3 * 4 + 2 * 32 + messageCount * 324;
}

const MAX_MESSAGE_COUNT = 5;

describe("ephemeral-account-chats magicsvm", () => {
  const userAKp = Keypair.generate();
  const userBKp = Keypair.generate();
  const {
    svm,
    payer,
    program,
    validator: validatorStr,
  } = bootAnchorSvm<EphemeralAccountChats>({
    fromDir: __dirname,
    programName: "ephemeral_account_chats",
    payer: userAKp,
    airdropLamports: BigInt(anchor.web3.LAMPORTS_PER_SOL),
  });
  const userA = new anchor.Wallet(payer);
  const userB = new anchor.Wallet(userBKp);
  const validator = new PublicKey(validatorStr);

  const nameA = generateName();
  const nameB = generateName();

  const [profileAPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("profile"), Buffer.from(nameA)],
    program.programId,
  );
  const [profileBPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("profile"), Buffer.from(nameB)],
    program.programId,
  );
  const [conversationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("conversation"), Buffer.from(nameA), Buffer.from(nameB)],
    program.programId,
  );

  async function instruction(builder: {
    instruction(): Promise<Parameters<typeof sendSvmIx>[2]>;
  }): Promise<Parameters<typeof sendSvmIx>[2]> {
    return builder.instruction();
  }

  before(() => {
    airdropOrThrow(
      svm,
      userB.publicKey,
      BigInt(anchor.web3.LAMPORTS_PER_SOL),
      "airdrop user B",
    );

    console.log("Program ID: ", program.programId.toBase58());
    console.log("Validator: ", validator.toBase58());
    console.log("User A: ", userA.publicKey.toBase58());
    console.log("User B: ", userB.publicKey.toBase58());
    console.log("Profile A: ", profileAPda.toBase58());
    console.log("Profile B: ", profileBPda.toBase58());
    console.log("Conversation: ", conversationPda.toBase58());
  });

  it("creates profiles", async () => {
    sendSvmIx(
      svm,
      [userAKp],
      await instruction(
        program.methods.createProfile(nameA).accountsPartial({
          authority: userA.publicKey,
          profile: profileAPda,
          systemProgram: SystemProgram.programId,
        }),
      ),
      "base",
    );
    sendSvmIx(
      svm,
      [userBKp],
      await instruction(
        program.methods.createProfile(nameB).accountsPartial({
          authority: userB.publicKey,
          profile: profileBPda,
          systemProgram: SystemProgram.programId,
        }),
      ),
      "base",
    );

    const profileA = program.coder.accounts.decode(
      "profile",
      Buffer.from(requireAccount(svm, profileAPda, "base").data),
    );
    const profileB = program.coder.accounts.decode(
      "profile",
      Buffer.from(requireAccount(svm, profileBPda, "base").data),
    );
    expect(profileA.handle).to.equal(nameA);
    expect(profileB.handle).to.equal(nameB);
  });

  it("tops up profiles", async () => {
    const profileABefore = requireAccount(svm, profileAPda, "base");
    const profileALamportsBefore = Number(profileABefore.lamports);

    sendSvmIx(
      svm,
      [userAKp],
      await instruction(
        program.methods
          .topUpProfile(new anchor.BN(0.05 * anchor.web3.LAMPORTS_PER_SOL))
          .accounts({
            authority: userA.publicKey,
            profile: profileAPda,
            systemProgram: SystemProgram.programId,
          }),
      ),
      "base",
    );

    const profileA = requireAccount(svm, profileAPda, "base");
    expect(Number(profileA.lamports)).to.equal(
      0.05 * anchor.web3.LAMPORTS_PER_SOL + profileALamportsBefore,
    );
  });

  it("delegates profiles", async () => {
    sendSvmIx(
      svm,
      [userAKp],
      await instruction(
        program.methods.delegateProfile(validator).accounts({
          authority: userA.publicKey,
          profile: profileAPda,
        }),
      ),
      "base",
    );
    sendSvmIx(
      svm,
      [userBKp],
      await instruction(
        program.methods.delegateProfile(validator).accounts({
          authority: userB.publicKey,
          profile: profileBPda,
        }),
      ),
      "base",
    );

    const profileA = requireAccount(svm, profileAPda, "base");
    const profileB = requireAccount(svm, profileBPda, "base");
    expect(profileA.programAddress.toString()).to.equal(
      DELEGATION_PROGRAM_ID.toBase58(),
    );
    expect(profileB.programAddress.toString()).to.equal(
      DELEGATION_PROGRAM_ID.toBase58(),
    );
  });

  it("creates a conversation", async () => {
    sendSvmIx(
      svm,
      [userAKp],
      await instruction(
        program.methods.createConversation().accounts({
          authority: userA.publicKey,
          profileOwner: profileAPda,
          profileOther: profileBPda,
          conversation: conversationPda,
          systemProgram: SystemProgram.programId,
        }),
      ),
      "ephemeral",
    );

    const conversationAccount = requireAccount(
      svm,
      conversationPda,
      "ephemeral",
    );
    const conversation = program.coder.accounts.decode(
      "conversation",
      Buffer.from(conversationAccount.data),
    );
    expect(conversation.messages.length).to.equal(0);
    expect(conversationAccount.data.length).to.equal(conversationSize(0));
  });

  it("extends a conversation", async () => {
    sendSvmIx(
      svm,
      [userAKp],
      await instruction(
        program.methods.extendConversation(MAX_MESSAGE_COUNT).accountsPartial({
          authority: userA.publicKey,
          profileSender: profileAPda,
          profileOther: profileBPda,
          conversation: conversationPda,
        }),
      ),
      "ephemeral",
    );

    const conversation = requireAccount(svm, conversationPda, "ephemeral");
    expect(conversation.data.length).to.equal(
      conversationSize(MAX_MESSAGE_COUNT),
    );
  });

  it("appends messages to a conversation", async () => {
    const nMessages = MAX_MESSAGE_COUNT;
    for (let i = 0; i < nMessages; i++) {
      if (i % 2 === 0) {
        sendSvmIx(
          svm,
          [userAKp],
          await instruction(
            program.methods
              .appendMessage(`Hello ${i} from user A!`)
              .accountsPartial({
                authority: userA.publicKey,
                profileOwner: profileAPda,
                profileOther: profileBPda,
                conversation: conversationPda,
              }),
          ),
          "ephemeral",
        );
      } else {
        sendSvmIx(
          svm,
          [userBKp],
          await instruction(
            program.methods
              .appendMessage(`Hello ${i} from user B!`)
              .accountsPartial({
                authority: userB.publicKey,
                profileOwner: profileAPda,
                profileOther: profileBPda,
                conversation: conversationPda,
              }),
          ),
          "ephemeral",
        );
      }
    }

    const conversationAccount = requireAccount(
      svm,
      conversationPda,
      "ephemeral",
    );
    const conversation = program.coder.accounts.decode(
      "conversation",
      Buffer.from(conversationAccount.data),
    );
    expect(conversation.messages.length).to.equal(nMessages);

    const failed = sendExpectingFailure(
      svm,
      [userAKp],
      await instruction(
        program.methods
          .appendMessage(
            "Hello world, appending another message, this should be failed!",
          )
          .accountsPartial({
            authority: userA.publicKey,
            profileOwner: profileAPda,
            profileOther: profileBPda,
            conversation: conversationPda,
          }),
      ),
      "ephemeral",
    );
    const expectedError = program.idl.errors.find(
      (e) =>
        e.name === "conversationCapacityExceeded" ||
        e.name === "ConversationCapacityExceeded",
    );
    expect(failed.meta().logs().join("\n")).to.include(expectedError?.msg);
  });

  it("closes a conversation", async () => {
    sendSvmIx(
      svm,
      [userAKp],
      await instruction(
        program.methods.closeConversation().accounts({
          authority: userA.publicKey,
          profileOwner: profileAPda,
          profileOther: profileBPda,
          conversation: conversationPda,
        }),
      ),
      "ephemeral",
    );
  });

  it("undelegates profiles", async () => {
    sendSvmIx(
      svm,
      [userAKp],
      await instruction(
        program.methods.undelegateProfile().accountsPartial({
          authority: userA.publicKey,
          profile: profileAPda,
        }),
      ),
      "ephemeral",
    );
    sendSvmIx(
      svm,
      [userBKp],
      await instruction(
        program.methods.undelegateProfile().accountsPartial({
          authority: userB.publicKey,
          profile: profileBPda,
        }),
      ),
      "ephemeral",
    );

    const profileA = requireAccount(svm, profileAPda, "base");
    const profileB = requireAccount(svm, profileBPda, "base");
    expect(profileA.programAddress.toString()).to.equal(
      program.programId.toBase58(),
    );
    expect(profileB.programAddress.toString()).to.equal(
      program.programId.toBase58(),
    );
  });

  it("closes profiles and refunds user A", async () => {
    sendSvmIx(
      svm,
      [userAKp],
      await instruction(
        program.methods.closeProfile().accounts({
          authority: userA.publicKey,
          profile: profileAPda,
        }),
      ),
      "base",
    );
    sendSvmIx(
      svm,
      [userBKp],
      await instruction(
        program.methods.closeProfile().accounts({
          authority: userB.publicKey,
          profile: profileBPda,
        }),
      ),
      "base",
    );

    expect(svm.getAccount(profileAPda).exists).to.equal(false);
    expect(svm.getAccount(profileBPda).exists).to.equal(false);
  });
});
