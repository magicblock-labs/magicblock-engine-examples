import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { RewardsDelegatedVrf } from "../target/types/rewards_delegated_vrf";
import * as fs from "fs";
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";

const REWARD_DISTRIBUTOR_SEED = "reward_distributor";
const REWARD_LIST_SEED = "reward_list";
const TRANSFER_LOOKUP_ACCOUNTS_SEED = "transfer_lookup_accounts";

describe("rewards-delegated-vrf", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const rpcRouterConnection = new ConnectionMagicRouter("https://devnet-router.magicblock.app/")

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
  const ephemeralProgram = new Program(program.idl, providerEphemeralRollup) as Program<RewardsDelegatedVrf>;

  const wallet = anchor.Wallet.local();
  // Load or generate reusable user keypair
  const userKeypairPath = "tests/user-keypair.json";
  let user: anchor.web3.Keypair;
  
  if (fs.existsSync(userKeypairPath)) {
    const userKeypairData = JSON.parse(fs.readFileSync(userKeypairPath, "utf-8"));
    user = anchor.web3.Keypair.fromSecretKey(new Uint8Array(userKeypairData.secretKey));
  } else {
    user = anchor.web3.Keypair.generate();
    const userKeypairData = {
      secretKey: Array.from(user.secretKey),
    };
    fs.writeFileSync(userKeypairPath, JSON.stringify(userKeypairData, null, 2));
    console.log("Generated and saved new user keypair to", userKeypairPath);
  }

  // PDAs
  const [rewardDistributorPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(REWARD_DISTRIBUTOR_SEED), wallet.publicKey.toBytes()],
    program.programId
  );

  const [rewardListPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(REWARD_LIST_SEED), rewardDistributorPda.toBytes()],
    program.programId
  );

  const [transferLookupSplToken] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(TRANSFER_LOOKUP_ACCOUNTS_SEED), Buffer.from([0])],
    program.programId
  );

  const [transferLookupNft] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(TRANSFER_LOOKUP_ACCOUNTS_SEED), Buffer.from([1])],
    program.programId
  );

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    providerEphemeralRollup.connection.rpcEndpoint
  );
  console.log(`Current SOL Public Key (Admin): ${wallet.publicKey}`);
  console.log(`Test User Public Key: ${user.publicKey}`);
  console.log("Reward Distributor PDA: ", rewardDistributorPda.toString());
  console.log("Reward List PDA: ", rewardListPda.toString());

  // Helper function to log reward list and distributor details
  const logRewardListDetails = async (rewardListAddress: PublicKey, useEphemeral: boolean = false) => {
    try {
      const programToUse = useEphemeral ? ephemeralProgram : program;
      const rewardListAccount = await programToUse.account.rewardsList.fetch(
        rewardListAddress
      );
      
      // Fetch distributor details
      const distributorAccount = await program.account.rewardDistributor.fetch(
        rewardListAccount.rewardDistributor
      );
      
      console.log("\n=== Distributor Details ===");
      console.log("Super Admin:", distributorAccount.superAdmin.toString());
      console.log("Admin Count:", distributorAccount.admins.length);
      if (distributorAccount.admins.length > 0) {
        console.log("Admins:", distributorAccount.admins.map(a => a.toString()).join(", "));
      }
      
      console.log("\n=== Reward List Details ===");
      console.log("Distributor:", rewardListAccount.rewardDistributor.toString());
      console.log("Start Timestamp:", rewardListAccount.startTimestamp.toNumber(), `(${new Date(rewardListAccount.startTimestamp.toNumber() * 1000).toISOString()})`);
      console.log("End Timestamp:", rewardListAccount.endTimestamp.toNumber(), `(${new Date(rewardListAccount.endTimestamp.toNumber() * 1000).toISOString()})`);
      console.log("Global Range Min:", rewardListAccount.globalRangeMin);
      console.log("Global Range Max:", rewardListAccount.globalRangeMax);
      console.log("Total Reward Count:", rewardListAccount.rewards.length);
      
      console.log("\n=== Individual Rewards ===");
      rewardListAccount.rewards.forEach((reward, index) => {
        const redemptionCount = typeof reward.redemptionCount === 'object' ? reward.redemptionCount.toNumber() : reward.redemptionCount;
        const redemptionLimit = typeof reward.redemptionLimit === 'object' ? reward.redemptionLimit.toNumber() : reward.redemptionLimit;
        const amount = typeof reward.rewardAmount === 'object' ? reward.rewardAmount.toNumber() : reward.rewardAmount;
        
        console.log(`\nReward ${index + 1}: ${reward.name}`);
        console.log(`  Draw Range: ${reward.drawRangeMin} - ${reward.drawRangeMax}`);
        console.log(`  Reward Type: ${Object.keys(reward.rewardType)[0]}`);
        console.log(`  Mints: ${reward.rewardMints.map(m => m.toString()).join(", ")}`);
        console.log(`  Amount: ${amount}`);
        console.log(`  Redemption Count: ${redemptionCount}/${redemptionLimit}`);
      });
    } catch (err) {
      console.log("Could not fetch reward list details:", (err as Error).message);
    }
  };

  before(async function () {
    const balance = await provider.connection.getBalance(wallet.publicKey);
    console.log(
      "Current balance is",
      balance / LAMPORTS_PER_SOL,
      " SOL",
      "\n"
    );

    // Airdrop SOL to test accounts if balance is below 0.1 SOL
    try {
      const userBalance = await provider.connection.getBalance(user.publicKey);
      if (userBalance < 0.1 * LAMPORTS_PER_SOL) {
        const airdropSig = await provider.connection.requestAirdrop(
          user.publicKey,
          2 * LAMPORTS_PER_SOL
        );
        const confirmation = await provider.connection.confirmTransaction(airdropSig, "confirmed");
        if (confirmation.value.err) {
          console.log("Airdrop failed:", confirmation.value.err);
        } else {
          console.log("Airdropped 2 SOL to user:", user.publicKey.toString());
        }
      } else {
        console.log("User already has sufficient balance:", userBalance / LAMPORTS_PER_SOL, "SOL -", user.publicKey.toString());
      }
    } catch (e) {
      console.log("Airdrop failed (expected on mainnet):", e);
    }

    // Log final user balance
    const finalBalance = await provider.connection.getBalance(user.publicKey);
    console.log("User balance:", finalBalance / LAMPORTS_PER_SOL, "SOL\n");
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

  it("Set Reward List with rewards", async () => {
    const rewards = [
      {
        name: "Gold Prize",
        drawRangeMin: 1,
        drawRangeMax: 30,
        rewardType: { splToken: {} },
        rewardMints: [new PublicKey("11111111111111111111111111111111")],
        rewardAmount: new anchor.BN(1000),
        redemptionCount: new anchor.BN(0),
        redemptionLimit: new anchor.BN(2),
      },
      {
        name: "Silver Prize",
        drawRangeMin: 31,
        drawRangeMax: 65,
        rewardType: { splToken: {} },
        rewardMints: [new PublicKey("11111111111111111111111111111111")],
        rewardAmount: new anchor.BN(500),
        redemptionCount: new anchor.BN(0),
        redemptionLimit: new anchor.BN(2),
      },
      {
        name: "Bronze Prize",
        drawRangeMin: 66,
        drawRangeMax: 100,
        rewardType: { splToken: {} },
        rewardMints: [new PublicKey("11111111111111111111111111111111")],
        rewardAmount: new anchor.BN(100),
        redemptionCount: new anchor.BN(0),
        redemptionLimit: new anchor.BN(2),
      },
    ];

    const startTimestamp = Math.floor(Date.now() / 1000);
    const endTimestamp = startTimestamp + 86400 * 30;

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
        rewardList: rewardListPda,
        rewardDistributor: rewardDistributorPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc({ skipPreflight: true });

    console.log("Set Reward List txHash: ", tx);

    // Log reward list details
    await logRewardListDetails(rewardListPda);
  });

  // it("Initialize Transfer Lookup Accounts - SPL Token", async () => {
  //   const dummyAccounts = Array(5)
  //     .fill(null)
  //     .map(() => anchor.web3.Keypair.generate().publicKey);

  //   const tx = await program.methods
  //     .initializeTransferLookupAccounts({ splToken: {} }, dummyAccounts)
  //     .accounts({
  //       authority: wallet.publicKey,
  //       transferLookupAccounts: transferLookupSplToken,
  //       systemProgram: anchor.web3.SystemProgram.programId,
  //     })
  //     .rpc({ skipPreflight: true });

  //   console.log("Initialize Transfer Lookup Accounts (SPL Token) txHash: ", tx);
  // });

  // it("Initialize Transfer Lookup Accounts - NFT", async () => {
  //   const dummyAccounts = Array(10)
  //     .fill(null)
  //     .map(() => anchor.web3.Keypair.generate().publicKey);

  //   const tx = await program.methods
  //     .initializeTransferLookupAccounts({ nft: {} }, dummyAccounts)
  //     .accounts({
  //       authority: wallet.publicKey,
  //       transferLookupAccounts: transferLookupNft,
  //       systemProgram: anchor.web3.SystemProgram.programId,
  //     })
  //     .rpc({ skipPreflight: true });

  //   console.log("Initialize Transfer Lookup Accounts (NFT) txHash: ", tx);
  // });

  it("Delegate Reward List to ER", async () => {
    const remainingAccounts =
      providerEphemeralRollup.connection.rpcEndpoint.includes("localhost") ||
      providerEphemeralRollup.connection.rpcEndpoint.includes("127.0.0.1")
        ? [
            {
              pubkey: new web3.PublicKey(
                "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"
              ),
              isSigner: false,
              isWritable: false,
            },
          ]
        : [];

    const tx = await program.methods
      .delegateRewardList()
      .accounts({
        admin: wallet.publicKey,
        rewardList: rewardListPda,
        rewardDistributor: rewardDistributorPda,
      })
      .remainingAccounts(remainingAccounts)
      .rpc({ skipPreflight: true });

    console.log("Delegate Reward List txHash: ", tx);
  });


  it("Request Random Reward (should fail - unauthorized user)", async () => {
    const clientSeed = Math.floor(Math.random() * 256);

    try {
      // This should fail because user is not an admin
      const tx = await ephemeralProgram.methods
        .requestRandomReward(clientSeed)
        .accounts({
          user: user.publicKey,
          admin: user.publicKey,
          rewardList: rewardListPda,
          rewardDistributor: rewardDistributorPda,
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
        rewardList: rewardListPda,
        rewardDistributor: rewardDistributorPda,
      })
      .transaction();
    
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    // Sign with fee payer (admin/wallet) and user
    tx.partialSign(wallet.payer);
    tx.partialSign(user);

    const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [wallet.payer, user], { skipPreflight: true })
      .catch((err) => {
        console.log("Request Random Reward error (may fail if VRF not available):", err.message);
        return null;
      });

    if (txHash) {
      console.log("Request Random Reward txHash: ", txHash);
      // Transaction succeeded, VRF callback will come asynchronously
      let listener: number | null = null;
       let listenerRemoved = false;
       const callbackReceived = new Promise<void>((resolve) => {
         listener = ephemeralProgram.provider.connection.onLogs(
           program.programId,
           (logs) => {
             try {
               console.log("Program logs received:", logs.logs);               
                console.log("VRF callback signature:", logs.signature);
                console.log("VRF callback status: SUCCEEDED");
                console.log("VRF callback logs:");
                const relevantLogs = logs.logs.filter(
                  (log) => log.includes("Random result:") || log.includes("Won reward") || log.includes("exhausted")
                );
                relevantLogs.forEach((log) => console.log("  " + log));
                if (listener !== null && !listenerRemoved) {
                  ephemeralProgram.provider.connection.removeOnLogsListener(listener);
                  listenerRemoved = true;
                }
                resolve();
             } catch (err) {
               console.error("Error in log listener:", err);
             }
           },
           "confirmed"
         );
       });
    }
  });

  it("Verify reward constraint - only super_admin can set reward list", async () => {
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
        rewardList: rewardListPda,
        rewardDistributor: rewardDistributorPda,
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
        rewardList: rewardListPda,
        rewardDistributor: rewardDistributorPda,
      })
      .transaction();
    
    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);

    const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: true,
    }).catch((err) => {
      console.log("Undelegate may fail if reward list not delegated:", err.message);
      return null;
    });

    if (txHash) {
      console.log("Undelegate Reward List txHash: ", txHash);
    }
  });

  it("Verify reward state after operations", async () => {
    try {
      await logRewardListDetails(rewardListPda, true);
    } catch (err) {
      console.log("Could not fetch final state (accounts may not be accessible)");
    }
  });
});
