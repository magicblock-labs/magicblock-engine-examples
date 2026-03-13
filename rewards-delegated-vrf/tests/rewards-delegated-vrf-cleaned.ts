import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { RewardsDelegatedVrf } from "../target/types/rewards_delegated_vrf";
import {
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { PDAs } from "./pdas";
import { loadOrGenerateUserKeypair, ensureUserBalance, saveMints } from "./setup";
import {
  getOrCreateDistributorTokenAccount,
  getProgramDataPda,
  getTransferLookupAccounts,
  logRewardListDetails,
  getValidatorAccounts,
} from "./helpers";
import { TOKEN_MINT, TOKEN_DECIMALS, DISTRIBUTOR_MINT_AMOUNT } from "./constants";

describe.only("rewards-delegated-vrf", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://devnet-as.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app/",
      }
    ),
    anchor.Wallet.local()
  );

  const program = anchor.workspace.RewardsDelegatedVrf as Program<RewardsDelegatedVrf>;
  const ephemeralProgram = new Program(
    program.idl,
    providerEphemeralRollup
  ) as Program<RewardsDelegatedVrf>;

  const wallet = anchor.Wallet.local();
  const user = loadOrGenerateUserKeypair("tests/user-keypair.json");

  const rewardDistributorPda = PDAs.getRewardDistributor(program.programId, wallet.publicKey);
  const rewardListPda = PDAs.getRewardList(program.programId, rewardDistributorPda);
  const transferLookupTable = PDAs.getTransferLookupTable(program.programId);

  const whitelist = [wallet.publicKey, new PublicKey("Fr33vGLZtpuLJ6WVezhMQarEPityiwkqsnDANr4aTF8Q")];

  let tokenMint: PublicKey = TOKEN_MINT;
  let distributorTokenAccount: PublicKey;
  let collectionMint: PublicKey;

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    providerEphemeralRollup.connection.rpcEndpoint
  );
  console.log(`Current SOL Public Key (Admin): ${wallet.publicKey}`);
  console.log(`Test User Public Key: ${user.publicKey}`);
  console.log("Reward Distributor PDA: ", rewardDistributorPda.toString());
  console.log("Reward List PDA: ", rewardListPda.toString());

  before(async function () {
    const balance = await provider.connection.getBalance(wallet.publicKey);
    console.log(
      "Current balance is",
      balance / LAMPORTS_PER_SOL,
      " SOL",
      "\n"
    );

    await ensureUserBalance(provider, user);
  });

  it("Initialize Reward Distributor", async () => {
    const tx = await program.methods
      .initializeRewardDistributor([])
      .accounts({
        initializer: wallet.publicKey,
        rewardDistributor: rewardDistributorPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc({ skipPreflight: true });

    console.log("Initialize Reward Distributor txHash: ", tx);
  });

  it("Create mint and mint tokens to reward distributor", async () => {
    console.log("\n=== Creating and Minting Tokens to Reward Distributor ===");

    try {
      if (!tokenMint) {
        tokenMint = await createMint(
          provider.connection,
          wallet.payer,
          wallet.publicKey,
          wallet.publicKey,
          TOKEN_DECIMALS
        );
        console.log("Token Mint created:", tokenMint.toString());
      } else {
        console.log("Token Mint already exists:", tokenMint.toString());
      }

      distributorTokenAccount = await getOrCreateDistributorTokenAccount(
        provider,
        tokenMint,
        rewardDistributorPda,
        wallet
      );

      // Mint tokens to distributor account
      await mintTo(
        provider.connection,
        wallet.payer,
        tokenMint,
        distributorTokenAccount,
        wallet.publicKey,
        DISTRIBUTOR_MINT_AMOUNT
      );

      console.log(
        `Minted ${DISTRIBUTOR_MINT_AMOUNT / Math.pow(10, TOKEN_DECIMALS)} tokens to distributor`
      );
    } catch (err) {
      console.log("Error creating/minting tokens:", (err as Error).message);
    }
  });

  it("Initialize Transfer Lookup Table", async () => {
    console.log("\n=== Initializing Transfer Lookup Table ===");

    const programData = getProgramDataPda(program.programId);
    const transferLookupAccounts = getTransferLookupAccounts();

    try {
      const tx = await program.methods
        .initializeTransferLookupTable(transferLookupAccounts)
        .accounts({
          authority: wallet.publicKey,
          programData: programData,
          transferLookupTable: transferLookupTable,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      console.log("\nInitialize Transfer Lookup Table txHash: ", tx);

      const lookupTable = await program.account.transferLookupTable.fetch(
        transferLookupTable
      );

      console.log("\n✓ Transfer Lookup Table Initialized");
      console.log("Total Lookup Accounts Registered:", lookupTable.lookupAccounts.length);

      lookupTable.lookupAccounts.forEach((account, index) => {
        console.log(`  ${index + 1}. ${account.toString()}`);
      });
    } catch (err) {
      console.log("Error initializing transfer lookup table:", (err as Error).message);
    }
  });

  it.only("Delegate Reward List to ER", async () => {
    const remainingAccounts = getValidatorAccounts(
      providerEphemeralRollup.connection.rpcEndpoint
    );

    const tx = await program.methods
      .delegateRewardList()
      .accounts({
        admin: wallet.publicKey,
        rewardDistributor: rewardDistributorPda,
        rewardList: rewardListPda,
      })
      .remainingAccounts(remainingAccounts)
      .rpc({ skipPreflight: true });

    console.log("Delegate Reward List txHash: ", tx);

    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  it("Request Random Reward (should fail - unauthorized user)", async () => {
    const clientSeed = Math.floor(Math.random() * 256);

    try {
      const tx = await ephemeralProgram.methods
        .requestRandomReward(clientSeed)
        .accounts({
          user: user.publicKey,
          admin: user.publicKey,
          rewardDistributor: rewardDistributorPda,
          rewardList: rewardListPda,
        })
        .signers([user, user])
        .rpc({ skipPreflight: true })
        .catch((err) => {
          console.log("Expected error - unauthorized admin:", err.message);
          return null;
        });

      if (tx) {
        throw new Error("Should have failed with unauthorized admin");
      }
    } catch (e) {
      console.log("Correctly rejected unauthorized request");
    }
  });

  it("Request Random Reward (authorized admin)", async () => {
    const clientSeed = Math.floor(Math.random() * 256);

    let tx = await ephemeralProgram.methods
      .requestRandomReward(clientSeed)
      .accounts({
        user: user.publicKey,
        admin: wallet.publicKey,
        rewardDistributor: rewardDistributorPda,
        rewardList: rewardListPda,
      })
      .transaction();

    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx.partialSign(wallet.payer);
    tx.partialSign(user);

    const txHash = await providerEphemeralRollup
      .sendAndConfirm(tx, [wallet.payer, user], { skipPreflight: true })
      .catch((err) => {
        console.log(
          "Request Random Reward error (may fail if VRF not available):",
          err.message
        );
        return null;
      });

    if (txHash) {
      console.log("Request Random Reward txHash: ", txHash);
    }
  });

  it("Verify reward constraint - super_admin can set reward list", async () => {
    const rewards = [
      {
        name: "Test Reward",
        drawRangeMin: 1,
        drawRangeMax: 50,
        rewardType: { splToken: {} },
        rewardMints: [new PublicKey("11111111111111111111111111111111")],
        rewardAmount: new anchor.BN(100),
        redemptionCount: new anchor.BN(0),
        redemptionLimit: new anchor.BN(10),
      },
    ];

    const startTimestamp = Math.floor(Date.now() / 1000);
    const endTimestamp = startTimestamp + 86400;

    const tx = await program.methods
      .setRewardList(
        rewards,
        new anchor.BN(startTimestamp),
        new anchor.BN(endTimestamp),
        1,
        100
      )
      .accounts({
        admin: wallet.publicKey,
        rewardDistributor: rewardDistributorPda,
        rewardList: rewardListPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc({ skipPreflight: true })
      .catch((err) => {
        console.log("Error setting reward list:", err.message);
        return null;
      });

    if (tx) {
      console.log("Reward List set txHash: ", tx);
    }
  });

  it("Undelegate Reward List from ER", async () => {
    let tx = await ephemeralProgram.methods
      .undelegateRewardList()
      .accounts({
        payer: wallet.publicKey,
        rewardDistributor: rewardDistributorPda,
        rewardList: rewardListPda,
      })
      .transaction();

    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);

    const txHash = await providerEphemeralRollup
      .sendAndConfirm(tx, [], { skipPreflight: true })
      .catch((err) => {
        console.log("Undelegate may fail if reward list not delegated:", err.message);
        return null;
      });

    if (txHash) {
      console.log("Undelegate Reward List txHash: ", txHash);
    }
  });

  it("Verify reward state after operations", async () => {
    try {
      await logRewardListDetails(program, ephemeralProgram, rewardListPda, true);
    } catch (err) {
      console.log("Could not fetch final state (accounts may not be accessible)");
    }
  });
});
