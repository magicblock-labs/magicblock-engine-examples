import * as anchor from "@coral-xyz/anchor";
import { assert, expect } from "chai";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID, MAGIC_PROGRAM_ID, MAGIC_CONTEXT_ID, GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Program } from "@coral-xyz/anchor";
import { EphemeralAccountChats } from "../target/types/ephemeral_account_chats";

function generateName(): string {
  // Random number padded with 0s to 10 digits
  const randomNumber = Math.floor(Math.random() * 10000000000);
  return randomNumber.toString().padStart(10, '0');
}

function conversationSize(messageCount: number): number {
  return 8 + 1 + 3 * 4 + 2 * 32 + messageCount * 324;
}

const MAX_MESSAGE_COUNT = 5;

describe("ephemeral-account-chats", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program: Program<EphemeralAccountChats> = anchor.workspace.ephemeralAccountChats;
  const connection = provider.connection;
  const userA = provider.wallet;
  const userBKp = Keypair.generate();
  const userB = new anchor.Wallet(userBKp);

  const nameA = generateName();
  const nameB = generateName();

  const [profileAPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("profile"), Buffer.from(nameA)],
    program.programId
  );
  const [profileBPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("profile"), Buffer.from(nameB)],
    program.programId
  );
  const [conversationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("conversation"), Buffer.from(nameA), Buffer.from(nameB)],
    program.programId
  );

  const erRpcUrl =
    process.env.MAGICBLOCK_RPC_URL ?? "https://devnet.magicblock.app";
  const erConnection = new Connection(
    erRpcUrl,
    "confirmed"
  );
  let validator: PublicKey;
  const erProgramA = new Program<EphemeralAccountChats>(
    program.idl,
    new anchor.AnchorProvider(erConnection, userA)
  );
  const erProgramB = new Program<EphemeralAccountChats>(
    program.idl,
    new anchor.AnchorProvider(erConnection, userB)
  );

  ///---------------------------------------------------------------------------
  /// Base layer
  ///---------------------------------------------------------------------------

  before(async () => {
    // Transfer some balance to userB
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: userA.publicKey,
        toPubkey: userB.publicKey,
        lamports: 0.1 * anchor.web3.LAMPORTS_PER_SOL,
      })
    );
    tx.feePayer = userA.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const signedTx = await userA.signTransaction(tx);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash, "confirmed");

    const response = await fetch(erRpcUrl, {
      method: "POST", body: JSON.stringify({
        "method": "getIdentity",
        "jsonrpc": "2.0",
        "params": [{
          "commitment": "confirmed"
        }],
        "id": "c1cae191-92ec-4606-880c-c7817afaa121"
      })
    });
    const data: any = await response.json();
    validator = new PublicKey(data.result.identity);

    console.log("Validator: ", validator.toBase58());
    console.log("User A: ", userA.publicKey.toBase58());
    console.log("User B: ", userB.publicKey.toBase58());
    console.log("Profile A: ", profileAPda.toBase58());
    console.log("Profile B: ", profileBPda.toBase58());
    console.log("Conversation: ", conversationPda.toBase58());
  });

  it("creates profiles", async () => {
    await program.methods
      .createProfile(nameA)
      .accountsPartial({
        authority: userA.publicKey,
        profile: profileAPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .createProfile(nameB)
      .accountsPartial({
        authority: userB.publicKey,
        profile: profileBPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([userBKp])
      .rpc();

    const profileA = await program.account.profile.fetch(profileAPda);
    const profileB = await program.account.profile.fetch(profileBPda);
    expect(profileA.handle).to.equal(nameA);
    expect(profileB.handle).to.equal(nameB);
  });

  it("tops up profiles", async () => {
    let profileA = await connection.getAccountInfo(profileAPda);
    const profileALamportsBefore = profileA?.lamports ?? 0;

    await program.methods
      .topUpProfile(new anchor.BN(0.05 * anchor.web3.LAMPORTS_PER_SOL))
      .accounts({
        authority: userA.publicKey,
        profile: profileAPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    profileA = await connection.getAccountInfo(profileAPda);
    expect(profileA?.lamports).to.equal(0.05 * anchor.web3.LAMPORTS_PER_SOL + profileALamportsBefore);
  });

  it("delegates profiles", async () => {
    await program.methods
      .delegateProfile(validator)
      .accounts({
        authority: userA.publicKey,
        profile: profileAPda,
      })
      .rpc();

    await program.methods
      .delegateProfile(validator)
      .accounts({
        authority: userB.publicKey,
        profile: profileBPda,
      })
      .signers([userBKp])
      .rpc();

    const profileA = await connection.getAccountInfo(profileAPda);
    const profileB = await connection.getAccountInfo(profileBPda);
    expect(profileA?.owner?.toBase58()).to.equal(DELEGATION_PROGRAM_ID.toBase58());
    expect(profileB?.owner?.toBase58()).to.equal(DELEGATION_PROGRAM_ID.toBase58());
  });

  ///---------------------------------------------------------------------------
  /// In the ephemeral rollup
  ///---------------------------------------------------------------------------

  it("creates a conversation", async () => {
    await erProgramA.methods
      .createConversation()
      .accounts({
        authority: userA.publicKey,
        profileOwner: profileAPda,
        profileOther: profileBPda,
        conversation: conversationPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const conversation = await erProgramA.account.conversation.fetch(conversationPda);
    expect(conversation.messages.length).to.equal(0);
    const conversationAccount = await erConnection.getAccountInfo(conversationPda);
    expect(conversationAccount?.data.length).to.equal(conversationSize(0));
  });

  it("extends a conversation", async () => {
    await erProgramA.methods
      .extendConversation(MAX_MESSAGE_COUNT)
      .accounts({
        authority: userA.publicKey,
        profileSender: profileAPda,
        profileOther: profileBPda,
      })
      .rpc();

    const conversation = await erConnection.getAccountInfo(conversationPda);
    expect(conversation?.data.length).to.equal(conversationSize(MAX_MESSAGE_COUNT));
  });

  it("appends messages to a conversation", async () => {
    let receivedMessages = 0;
    const subscriptionId = erConnection.onAccountChange(conversationPda, (account) => {
      const parsedMessage = erProgramA.coder.accounts.decode('conversation', account.data);
      receivedMessages++;
    });

    const nMessages = MAX_MESSAGE_COUNT;
    try {
      for (let i = 0; i < nMessages; i++) {
        if (i % 2 === 0) {
          await erProgramA.methods
            .appendMessage("Hello, world from user A!")
            .accountsPartial({
              authority: userA.publicKey,
              profileOwner: profileAPda,
              profileOther: profileBPda,
            })
            .rpc();
        } else {
          await erProgramB.methods
            .appendMessage("Hello, world from user B!")
            .accountsPartial({
              authority: userB.publicKey,
              profileOwner: profileAPda,
              profileOther: profileBPda,
            })
            .signers([userBKp])
            .rpc();
        }
      }

      const retries = 10;
      for (let i = 0; i < retries; i++) {
        if (receivedMessages === nMessages) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      await erConnection.removeAccountChangeListener(subscriptionId);
    }

    expect(receivedMessages).to.equal(nMessages);

    // Fails when the conversation is full
    try {
      await erProgramA.methods
        .appendMessage("Hello, world from user A!")
        .accountsPartial({
          authority: userA.publicKey,
          profileOwner: profileAPda,
          profileOther: profileBPda,
        })
        .rpc();
      assert.fail("The conversation should have been full");
    } catch (error) {
      let programError = error as anchor.ProgramError;
      const expectedError = program.idl.errors.find(e => e.name === "conversationCapacityExceeded");
      expect(programError.msg).to.equal(expectedError?.msg);
    }
  });

  it("closes a conversation", async () => {
    await erProgramA.methods
      .closeConversation()
      .accounts({
        authority: userA.publicKey,
        profileOwner: profileAPda,
        profileOther: profileBPda,
        conversation: conversationPda,
      })
      .rpc();
  });

  it("undelegates profiles", async () => {
    const txHashA = await erProgramA.methods
      .undelegateProfile()
      .accountsPartial({
        authority: userA.publicKey,
        profile: profileAPda,
      })
      .rpc();
    const txHashB = await erProgramB.methods
      .undelegateProfile()
      .accountsPartial({
        authority: userB.publicKey,
        profile: profileBPda,
      })
      .rpc();

    const commitmentSignatureA = await GetCommitmentSignature(txHashA, erConnection);
    const commitmentSignatureB = await GetCommitmentSignature(txHashB, erConnection);

    await connection.getTransaction(commitmentSignatureA, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    await connection.getTransaction(commitmentSignatureB, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });

    const profileA = await connection.getAccountInfo(profileAPda);
    const profileB = await connection.getAccountInfo(profileBPda);
    expect(profileA?.owner?.toBase58()).to.equal(program.programId.toBase58());
    expect(profileB?.owner?.toBase58()).to.equal(program.programId.toBase58());
  });

  ///---------------------------------------------------------------------------
  /// Base layer
  ///---------------------------------------------------------------------------

  it("closes profiles and refunds user A", async () => {
    await program.methods
      .closeProfile()
      .accounts({
        authority: userA.publicKey,
        profile: profileAPda,
      })
      .rpc();
    await program.methods
      .closeProfile()
      .accounts({
        authority: userB.publicKey,
        profile: profileBPda,
      })
      .signers([userBKp])
      .rpc();

    const profileA = await connection.getAccountInfo(profileAPda);
    const profileB = await connection.getAccountInfo(profileBPda);
    expect(profileA?.owner).to.be.undefined;
    expect(profileB?.owner).to.be.undefined;

    const userBBalance = await connection.getBalance(userB.publicKey);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: userB.publicKey,
        toPubkey: userA.publicKey,
        lamports: userBBalance - 5000,
      })
    );
    tx.feePayer = userB.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const signedTx = await userB.signTransaction(tx);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash, "confirmed");
  });
});
