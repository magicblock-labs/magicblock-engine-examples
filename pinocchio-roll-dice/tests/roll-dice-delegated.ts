import {
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  decodePlayer,
  DEFAULT_EPHEMERAL_QUEUE,
  DELEGATION_PROGRAM,
  getEphemeralConnection,
  getLocalConnection,
  getLocalKeypair,
  MAGIC_CONTEXT,
  MAGIC_PROGRAM,
  readProgramId,
  VALIDATOR,
  VRF_PROGRAM,
} from "./utils";
import { expect } from "chai";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";

describe("roll-dice-delegated", () => {
  // Configure the client to use the local cluster.
  const kp = getLocalKeypair();
  const baseConnection = getLocalConnection();
  const ephemeralConnection = getEphemeralConnection();
  const programId = readProgramId("roll_dice_delegated");
  const oracleQueue = DEFAULT_EPHEMERAL_QUEUE;

  const playerPda = PublicKey.findProgramAddressSync(
    [Buffer.from("player"), kp.publicKey.toBytes()],
    programId,
  )[0];

  console.log("Base Layer Connection: ", baseConnection.rpcEndpoint);
  console.log(`Current SOL Public Key: ${kp.publicKey}`);
  console.log("Player PDA: ", playerPda.toString());

  it("Initialized player!", async () => {
    const data = Buffer.alloc(8);
    data.writeBigUInt64LE(0n);
    const tx = new Transaction().add({
      programId,
      keys: [
        { pubkey: kp.publicKey, isSigner: true, isWritable: true },
        { pubkey: playerPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const blockhash = await baseConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash.blockhash;
    tx.lastValidBlockHeight = blockhash.lastValidBlockHeight;
    tx.feePayer = kp.publicKey;
    tx.sign(kp);
    const txHash = await baseConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    console.log("Your transaction signature", txHash);
    let confirmation = await baseConnection.confirmTransaction(
      txHash,
      "confirmed",
    );
    console.log("confirmation:", confirmation.value.err);
    expect(confirmation.value.err).to.be.null;
  });

  it("Delegate Roll Dice!", async () => {
    const bufferAccount = PublicKey.findProgramAddressSync(
      [Buffer.from("buffer"), playerPda.toBytes()],
      programId,
    )[0];
    const delegationRecord = PublicKey.findProgramAddressSync(
      [Buffer.from("delegation"), playerPda.toBytes()],
      DELEGATION_PROGRAM,
    )[0];
    const delegationMetadata = PublicKey.findProgramAddressSync(
      [Buffer.from("delegation-metadata"), playerPda.toBytes()],
      DELEGATION_PROGRAM,
    )[0];

    const data = Buffer.alloc(8);
    data.writeBigUInt64LE(3n);
    const tx = new Transaction().add({
      programId,
      keys: [
        { pubkey: kp.publicKey, isSigner: true, isWritable: true },
        { pubkey: playerPda, isSigner: false, isWritable: true },
        { pubkey: programId, isSigner: false, isWritable: false },
        { pubkey: bufferAccount, isSigner: false, isWritable: true },
        { pubkey: delegationRecord, isSigner: false, isWritable: true },
        { pubkey: delegationMetadata, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: DELEGATION_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: VALIDATOR, isSigner: false, isWritable: false },
      ],
      data,
    });
    const blockhash = await baseConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash.blockhash;
    tx.lastValidBlockHeight = blockhash.lastValidBlockHeight;
    tx.feePayer = kp.publicKey;
    tx.sign(kp);
    const txHash = await baseConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    console.log("Your transaction signature", txHash);
    const confirmation = await baseConnection.confirmTransaction(
      txHash,
      "confirmed",
    );
    console.log("confirmation:", confirmation.value.err);
    expect(confirmation.value.err).to.be.null;
  });

  it("Do Roll Dice!", async () => {
    // Generate the seed BEFORE subscribing so the handler closes over it.
    // The program logs "client_seed=N" inside callback_roll_dice — we match
    // on that exact substring to pin the callback to our specific request.
    const clientSeed = Math.floor(Math.random() * 256);
    const seedTag = `client_seed=${clientSeed}`;
    // Pre-arm a one-shot promise that the onLogs handler resolves with the
    // matching signature. No polling — we just await it, racing a timeout.
    let resolveSig!: (sig: string) => void;
    const sigPromise = new Promise<string>((r) => {
      resolveSig = r;
    });
    let callbackSubId: number | undefined;
    try {
      callbackSubId = ephemeralConnection.onLogs(
        programId,
        (info) => {
          console.log("Received log: ", info);
          if (
            !info.err &&
            info.logs.some((l) => l.includes("CallbackRollDice")) &&
            info.logs.some((l) => l.includes(seedTag))
          ) {
            resolveSig(info.signature);
          }
        },
        "confirmed",
      );

      const [programIdentity] = PublicKey.findProgramAddressSync(
        [Buffer.from("identity")],
        programId,
      );

      const data = Buffer.alloc(9);
      data.writeBigUInt64LE(1n, 0);
      data.writeUInt8(clientSeed, 8);
      const tx = new Transaction().add({
        programId,
        keys: [
          { pubkey: kp.publicKey, isSigner: true, isWritable: true },
          { pubkey: playerPda, isSigner: false, isWritable: false },
          { pubkey: oracleQueue, isSigner: false, isWritable: true },
          { pubkey: programIdentity, isSigner: false, isWritable: false },
          { pubkey: VRF_PROGRAM, isSigner: false, isWritable: false },
          {
            pubkey: SYSVAR_SLOT_HASHES_PUBKEY,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data,
      });
      const blockhash = await ephemeralConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash.blockhash;
      tx.lastValidBlockHeight = blockhash.lastValidBlockHeight;
      tx.feePayer = kp.publicKey;
      tx.sign(kp);
      const txHash = await ephemeralConnection.sendRawTransaction(
        tx.serialize(),
        {
          skipPreflight: true,
        },
      );
      console.log(`client_seed: ${clientSeed}`);
      console.log("rollDice tx:", txHash);
      let confirmation = await ephemeralConnection.confirmTransaction(
        txHash,
        "confirmed",
      );
      console.log("confirmation:", confirmation.value.err);
      expect(confirmation.value.err).to.be.null;

      const start = Date.now();
      const sig = await Promise.race([
        sigPromise,
        new Promise<null>((r) => setTimeout(() => r(null), 1_000)),
      ]);
      if (sig) {
        console.log(
          `callbackRollDice tx: ${sig} (after ${Date.now() - start}ms)`,
        );
        await ephemeralConnection.confirmTransaction(sig, "confirmed");
      } else {
        throw new Error(`callbackRollDice not observed within 1s.`);
      }

      const playerAccount = await ephemeralConnection.getAccountInfo(
        playerPda,
        "confirmed",
      );
      if (!playerAccount) {
        throw new Error("Player account not found");
      }
      const player = decodePlayer(playerAccount.data);
      console.log("player:", player);
      expect(player.rollnum).to.equal(1);
    } finally {
      if (callbackSubId !== undefined) {
        await ephemeralConnection.removeOnLogsListener(callbackSubId);
      }
    }
  });

  it("Undelegate Roll Dice!", async () => {
    const data = Buffer.alloc(8);
    data.writeBigUInt64LE(4n);
    const tx = new Transaction().add({
      programId,
      keys: [
        { pubkey: kp.publicKey, isSigner: true, isWritable: false },
        { pubkey: playerPda, isSigner: false, isWritable: true },
        { pubkey: MAGIC_CONTEXT, isSigner: false, isWritable: true },
        { pubkey: MAGIC_PROGRAM, isSigner: false, isWritable: false },
      ],
      data,
    });
    const blockhash = await ephemeralConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash.blockhash;
    tx.lastValidBlockHeight = blockhash.lastValidBlockHeight;
    tx.feePayer = kp.publicKey;
    tx.sign(kp);
    const txHash = await ephemeralConnection.sendRawTransaction(
      tx.serialize(),
      {
        skipPreflight: true,
      },
    );
    console.log("Your transaction signature", txHash);
    let confirmation = await ephemeralConnection.confirmTransaction(
      txHash,
      "confirmed",
    );
    console.log("confirmation:", confirmation.value.err);
    expect(confirmation.value.err).to.be.null;

    await GetCommitmentSignature(txHash, ephemeralConnection);
  });
});
