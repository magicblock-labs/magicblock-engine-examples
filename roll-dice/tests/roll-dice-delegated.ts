import * as anchor from "@coral-xyz/anchor";
import {Program} from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, Keypair, SystemProgram, Transaction, PublicKey } from "@solana/web3.js";
import { RandomDiceDelegated } from "../target/types/random_dice_delegated";
import * as crypto from "crypto";
import {
  DELEGATION_PROGRAM_ID,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  createDelegateInstruction,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";

describe("roll-dice-delegated", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.RandomDiceDelegated as Program<RandomDiceDelegated>;

  const providerEphemeralRollup = new anchor.AnchorProvider(
      new anchor.web3.Connection(
          process.env.PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app/",
          {
            wsEndpoint: process.env.WS_ENDPOINT || "wss://devnet.magicblock.app/",
          }
      ),
      anchor.Wallet.local()
  );
  const ephemeralProgram = new Program(program.idl, providerEphemeralRollup);

  const payer = anchor.Wallet.local().publicKey;
  
  const delegatedPayerKeypair = Keypair.generate();
  
  const [playerPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("playerd"), delegatedPayerKeypair.publicKey.toBuffer()],
    program.programId
  );

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log("Ephemeral Rollup Connection: ", providerEphemeralRollup.connection.rpcEndpoint);
  console.log(`Current SOL Public Key: ${payer}`)
  console.log("Player PDA: ", playerPda.toString());
  console.log("Delegated Payer Public Key: ", delegatedPayerKeypair.publicKey.toString());

  before(async function () {
    const balance = await provider.connection.getBalance(anchor.Wallet.local().publicKey)
    console.log('Current balance is', balance / LAMPORTS_PER_SOL, ' SOL','\n')
    
    const transferIx = SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: delegatedPayerKeypair.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL,
    });
    const tx = new Transaction().add(transferIx);
    await provider.sendAndConfirm(tx);
    console.log("Transferred 0.1 SOL to delegated payer keypair");
  })

  it("Initialized player!", async () => {
    const tx = await program.methods
      .initialize()
      .accounts({
        payer: delegatedPayerKeypair.publicKey,
      })
      .signers([delegatedPayerKeypair])
      .rpc();
    console.log("Your transaction signature", tx);
  });

  it("Delegate Roll Dice!", async () => {
    const tx = await program.methods
      .delegate()
      .accounts({
        user: delegatedPayerKeypair.publicKey,
      })
      .signers([delegatedPayerKeypair])
      .rpc();
    console.log("Your transaction signature", tx);
  });

  it("Delegate on-curve account", async () => {
    const delegatedAccount = delegatedPayerKeypair.publicKey;

    const assignIx = SystemProgram.assign({
      accountPubkey: delegatedAccount,
      programId: DELEGATION_PROGRAM_ID,
    });
    const assignTxHash = await provider.sendAndConfirm(new Transaction().add(assignIx), [delegatedPayerKeypair]);
    console.log("Assign transaction signature:", assignTxHash);

    const delegateIx = createDelegateInstruction({
      payer: provider.wallet.publicKey,
      delegatedAccount: delegatedAccount,
      ownerProgram: SystemProgram.programId,
    });
    const delegateTxHash = await provider.sendAndConfirm(new Transaction().add(delegateIx), [provider.wallet.payer,delegatedPayerKeypair]);
    console.log("Delegate transaction signature:", delegateTxHash);
    
    await new Promise(resolve => setTimeout(resolve, 5000));
  });

  it("Do Roll Dice Delegated with delegated payer!", async () => {
    // Create a wallet from the delegated keypair for the ephemeral provider
    const delegatedWallet = new anchor.Wallet(delegatedPayerKeypair);
    const ephemeralProviderWithDelegatedPayer = new anchor.AnchorProvider(
      providerEphemeralRollup.connection,
      delegatedWallet,
      {}
    );
    const ephemeralProgramWithDelegatedPayer = new Program(program.idl, ephemeralProviderWithDelegatedPayer);

    const tx = await ephemeralProgramWithDelegatedPayer.methods
      .rollDiceDelegated(1)
      .accounts({
        payer: delegatedPayerKeypair.publicKey,
        player: playerPda,
      })
      .rpc();
    console.log("Your transaction signature", tx);
    await new Promise(resolve => setTimeout(resolve, 5000));
  });

  it("Undelegate Roll Dice!", async () => {
    const delegatedWallet = new anchor.Wallet(delegatedPayerKeypair);
    const ephemeralProviderWithDelegatedPayer = new anchor.AnchorProvider(
      providerEphemeralRollup.connection,
      delegatedWallet,
      {}
    );
    const ephemeralProgramWithDelegatedPayer = new Program(program.idl, ephemeralProviderWithDelegatedPayer);
    
    const tx = await ephemeralProgramWithDelegatedPayer.methods
      .undelegate()
      .accounts({
        payer: delegatedPayerKeypair.publicKey,
      })
      .rpc();
    console.log("Your transaction signature", tx);
  });

  xit("Undelegate on-curve account", async () => {
    const delegatedAccount = delegatedPayerKeypair.publicKey;
    const undelegateDiscriminator = crypto
      .createHash("sha256")
      .update("global:undelegate")
      .digest()
      .slice(0, 8);
    
    // For on-curve accounts, seeds is empty vec
    const seedsLength = Buffer.allocUnsafe(4);
    seedsLength.writeUInt32LE(0, 0); // empty vec length
    
    const instructionData = Buffer.concat([
      undelegateDiscriminator,
      seedsLength,
    ]);

    const delegationRecordPda = delegationRecordPdaFromDelegatedAccount(delegatedAccount);
    const delegationMetadataPda = delegationMetadataPdaFromDelegatedAccount(delegatedAccount);

    const undelegateAccounts = [
      { pubkey: providerEphemeralRollup.wallet.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: delegatedAccount, isSigner: false, isWritable: true }, // delegated_account
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // owner_program (system for on-curve)
      { pubkey: delegationRecordPda, isSigner: false, isWritable: true }, // delegation_record
      { pubkey: delegationMetadataPda, isSigner: false, isWritable: true }, // delegation_metadata
      { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false }, // delegation_program
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false }, // magic_program
      { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true }, // magic_context
    ];

    const undelegateIx = new anchor.web3.TransactionInstruction({
      keys: undelegateAccounts,
      programId: DELEGATION_PROGRAM_ID,
      data: instructionData,
    });

    const undelegateTx = new Transaction().add(undelegateIx);
    undelegateTx.feePayer = providerEphemeralRollup.wallet.publicKey;
    undelegateTx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
    const undelegateTxHash = await providerEphemeralRollup.sendAndConfirm(undelegateTx);
    console.log("Undelegate transaction signature:", undelegateTxHash);

    // After undelegation, reassign the account back to system program
    const reassignIx = SystemProgram.assign({
      accountPubkey: delegatedAccount,
      programId: SystemProgram.programId,
    });

    const reassignTx = new Transaction().add(reassignIx);
    reassignTx.feePayer = provider.wallet.publicKey;
    reassignTx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
    reassignTx.sign(delegatedPayerKeypair);
    const reassignTxHash = await provider.sendAndConfirm(reassignTx, [delegatedPayerKeypair]);
    console.log("Reassign transaction signature:", reassignTxHash);
  });

});
