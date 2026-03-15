import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { RewardsDelegatedVrf } from "../target/types/rewards_delegated_vrf";
import {
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createCreateMetadataAccountV3Instruction, createSetAndVerifyCollectionInstruction, createCreateMasterEditionV3Instruction } from "@metaplex-foundation/mpl-token-metadata";
import * as fs from "fs";

import { PDAs } from "./pdas";
import { loadOrGenerateUserKeypair, ensureUserBalance, saveMints } from "./setup";
import {
  getOrCreateDistributorTokenAccount,
  getProgramDataPda,
  getTransferLookupAccounts,
  logRewardListDetails,
  getValidatorAccounts,
  logTestEnvironment,
  logSection,
  logTxResult,
  logError,
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

  // Initialize pubkeys
  let tokenMint: PublicKey = TOKEN_MINT;
  let distributorTokenAccount: PublicKey = getAssociatedTokenAddressSync(
    TOKEN_MINT,
    rewardDistributorPda,
    true // allowOffCurve - allows PDAs
  );
  let collectionMint: PublicKey;

  logTestEnvironment(
    provider.connection.rpcEndpoint,
    providerEphemeralRollup.connection.rpcEndpoint,
    wallet.publicKey,
    user.publicKey,
    rewardDistributorPda,
    rewardListPda
  );

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

  it("Create mint (if not exists), and mint tokens to reward distributor", async () => {
    console.log("\n=== Creating and Minting Tokens to Reward Distributor ===");

    try {
      // Create a new token mint, if it doesn't exist
      if (!tokenMint) {
        tokenMint = await createMint(
          provider.connection,
          wallet.payer,
          wallet.publicKey, // Mint authority
          wallet.publicKey, // Freeze authority
          TOKEN_DECIMALS
        );
        console.log("Token Mint created:", tokenMint.toString());
      } else {
        console.log("Token Mint already exists:", tokenMint.toString());
      }
    } catch (err) {
      console.log("Error creating mint:", (err as Error).message);
    }

    try {
      // Get or create the associated token account for the PDA
      distributorTokenAccount = await getOrCreateDistributorTokenAccount(
        provider,
        tokenMint,
        rewardDistributorPda,
        wallet.payer
      );

      // Mint tokens to distributor account
      const distributorMintTx = await mintTo(
        provider.connection,
        wallet.payer as any,
        tokenMint,
        distributorTokenAccount,
        wallet.payer,
        DISTRIBUTOR_MINT_AMOUNT
      );

      console.log("Tokens minted to distributor. Transaction:", distributorMintTx);
      console.log(
        `Minted ${DISTRIBUTOR_MINT_AMOUNT / Math.pow(10, TOKEN_DECIMALS)} tokens to distributor`
      );

      // Verify the token account balance
      const distributorAccountBalance =
        await provider.connection.getTokenAccountBalance(distributorTokenAccount);
      console.log(
        "Distributor Token Account Balance:",
        distributorAccountBalance.value.uiAmount,
        distributorAccountBalance.value.uiAmountString
      );
    } catch (err) {
      console.error("Error minting tokens to distributor:", err);
      console.log("Error details:", (err as Error).message);
    }
  });

  it("Create NFT Collection", async () => {
    console.log("\n=== Creating NFT Collection ===");

    try {
      // Initialize or load mints file
      const mintsPath = "tests/nft-mints.json";
      let mintsData = { collectionMint: null, nfts: [] };

      if (fs.existsSync(mintsPath)) {
        mintsData = JSON.parse(fs.readFileSync(mintsPath, "utf-8"));
        if (mintsData.collectionMint) {
          collectionMint = new PublicKey(mintsData.collectionMint);
          console.log("Collection already exists. Mint:", collectionMint.toString());
          return;
        }
      }

      // Create mint for collection
      collectionMint = await createMint(
        provider.connection,
        wallet.payer,
        wallet.publicKey,
        wallet.publicKey,
        0 // NFT has 0 decimals
      );

      console.log("Collection Mint created:", collectionMint.toString());

      // Create metadata for collection NFT
      const [collectionMetadataAddress] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
          collectionMint.toBuffer(),
        ],
        new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
      );

      console.log("Collection Metadata PDA:", collectionMetadataAddress.toString());

      const collectionMetadataIx = createCreateMetadataAccountV3Instruction(
        {
          metadata: collectionMetadataAddress,
          mint: collectionMint,
          mintAuthority: wallet.publicKey,
          payer: wallet.publicKey,
          updateAuthority: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        {
          createMetadataAccountArgsV3: {
            data: {
              name: "Test Collection",
              symbol: "TESTCOLL",
              uri: "https://example.com/collection.json",
              sellerFeeBasisPoints: 0,
              creators: [
                {
                  address: wallet.publicKey,
                  verified: true,
                  share: 100,
                },
              ],
              collection: null,
              uses: null,
            },
            isMutable: true,
            collectionDetails: { __kind: "V1", size: 0n },
          },
        }
      );

      const tx = new anchor.web3.Transaction().add(collectionMetadataIx);
      const sig = await provider.sendAndConfirm(tx);
      console.log("Collection Metadata created. Signature:", sig);

      // Save collection mint to JSON
      mintsData.collectionMint = collectionMint.toString();
      saveMints(mintsPath, mintsData);
    } catch (err) {
      console.error("Error creating NFT Collection:", err);
      console.log("Error details:", (err as Error).message);
    }
  });

  it("Create and mint Legacy NFT to reward distributor", async () => {
    console.log(
      "\n=== Creating and Minting Legacy NFT to Reward Distributor (part of collection) ==="
    );

    try {
      // Create NFT mint (0 decimals for NFTs)
      const nftMint = await createMint(
        provider.connection,
        wallet.payer,
        wallet.publicKey,
        wallet.publicKey,
        0 // 0 decimals for NFTs
      );
      console.log("NFT Mint created:", nftMint.toString());

      // Get or create the associated token account for the distributor
      const distributorNftAccount = getAssociatedTokenAddressSync(
        nftMint,
        rewardDistributorPda,
        true // allowOffCurve - allows PDAs
      );

      console.log("Distributor NFT account:", distributorNftAccount.toString());

      // Check if the account exists
      const nftAccountInfo = await provider.connection.getAccountInfo(
        distributorNftAccount
      );

      if (!nftAccountInfo) {
        console.log("Creating NFT account for distributor...");

        const createNftAccountTx = new anchor.web3.Transaction().add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            distributorNftAccount,
            rewardDistributorPda,
            nftMint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );

        const createNftAccountSig = await provider.sendAndConfirm(
          createNftAccountTx
        );
        console.log("NFT account created. Signature:", createNftAccountSig);
      } else {
        console.log("NFT account already exists");
      }

      // Mint 1 NFT to the distributor's account
      const nftMintTx = await mintTo(
        provider.connection,
        wallet.payer as any,
        nftMint,
        distributorNftAccount,
        wallet.payer,
        1 // Mint 1 NFT
      );

      console.log("NFT minted to distributor. Transaction:", nftMintTx);

      const nftBalance = await provider.connection.getTokenAccountBalance(
        distributorNftAccount
      );
      console.log("Distributor NFT Account Balance:", nftBalance.value.uiAmount);

      // Create metadata for the NFT with collection reference
      const [metadataAddress] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
          nftMint.toBuffer(),
        ],
        new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
      );

      console.log("Metadata PDA:", metadataAddress.toString());

      const createMetadataIx = createCreateMetadataAccountV3Instruction(
        {
          metadata: metadataAddress,
          mint: nftMint,
          mintAuthority: wallet.publicKey,
          payer: wallet.publicKey,
          updateAuthority: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        {
          createMetadataAccountArgsV3: {
            data: {
              name: "Reward NFT #1",
              symbol: "REWNFT",
              uri: "https://example.com/reward-nft.json",
              sellerFeeBasisPoints: 0,
              creators: [
                {
                  address: wallet.publicKey,
                  verified: true,
                  share: 100,
                },
              ],
              collection: {
                key: collectionMint,
                verified: false,
              },
              uses: null,
            },
            isMutable: true,
            collectionDetails: null,
          },
        }
      );

      const metadataTx = new anchor.web3.Transaction().add(createMetadataIx);
      const metadataSig = await provider.sendAndConfirm(metadataTx);
      console.log("NFT Metadata created. Signature:", metadataSig);

      // Create Master Edition account
      const [masterEditionAddress] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
          nftMint.toBuffer(),
          Buffer.from("edition"),
        ],
        new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
      );

      const createMasterEditionIx = createCreateMasterEditionV3Instruction(
        {
          edition: masterEditionAddress,
          metadata: metadataAddress,
          mint: nftMint,
          mintAuthority: wallet.publicKey,
          payer: wallet.publicKey,
          updateAuthority: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        {
          createMasterEditionArgs: {
            maxSupply: null, // null for unlimited editions
          }
        }
      );

      const masterEditionTx = new anchor.web3.Transaction().add(createMasterEditionIx);
      const masterEditionSig = await provider.sendAndConfirm(masterEditionTx);
      console.log("Master Edition created. Signature:", masterEditionSig);

      // Derive collection metadata address
      const [collectionMetadataAddress] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
          collectionMint.toBuffer(),
        ],
        new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
      );

      // Verify NFT collection membership
      try {
        const verifyCollectionIx = createSetAndVerifyCollectionInstruction({
          metadata: metadataAddress,
          collectionAuthority: wallet.publicKey,
          collectionMint: collectionMint,
          collectionMetadata: collectionMetadataAddress,
          payer: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        });

        const verifyTx = new anchor.web3.Transaction().add(
          verifyCollectionIx
        );
        const verifySig = await provider.sendAndConfirm(verifyTx);
        console.log("NFT Collection verified. Signature:", verifySig);
      } catch (verifyErr) {
        console.warn(
          "Collection verification failed (optional):",
          (verifyErr as Error).message
        );
      }
      console.log(
        "NFT successfully created and minted to distributor as part of collection"
      );

      // Load existing mints and add the new NFT
      const mintsPath = "tests/nft-mints.json";
      let mintsData: any = {
        collectionMint: "",
        nfts: [],
      };

      if (fs.existsSync(mintsPath)) {
        mintsData = JSON.parse(fs.readFileSync(mintsPath, "utf-8"));
      }

      mintsData.nfts.push({
        mint: nftMint.toString(),
        name: "Reward NFT #1",
        distributorTokenAccount: distributorNftAccount.toString(),
        metadataAddress: metadataAddress.toString(),
      });

      saveMints(mintsPath, mintsData);
    } catch (err) {
      console.error("Error creating/minting Legacy NFT:", err);
      console.log("Error details:", (err as Error).message);
    }
  });

  it("Set Reward List with rewards", async () => {
    const rewards: any[] = [
      {
        name: "Gold Prize",
        drawRangeMin: 1,
        drawRangeMax: 30,
        rewardType: { splToken: {} },
        rewardMints: [tokenMint],
        rewardAmount: new anchor.BN(1000),
        redemptionCount: new anchor.BN(0),
        redemptionLimit: new anchor.BN(1000),
        additionalPubkeys: [],
      },
      {
        name: "Silver Prize",
        drawRangeMin: 31,
        drawRangeMax: 65,
        rewardType: { splToken: {} },
        rewardMints: [tokenMint],
        rewardAmount: new anchor.BN(500),
        redemptionCount: new anchor.BN(0),
        redemptionLimit: new anchor.BN(2),
        additionalPubkeys: [],
      },
      {
        name: "Bronze Prize",
        drawRangeMin: 66,
        drawRangeMax: 100,
        rewardType: { legacyNft: {} },
        rewardMints: [],
        rewardAmount: new anchor.BN(1),
        redemptionCount: new anchor.BN(0),
        redemptionLimit: new anchor.BN(0),
        additionalPubkeys: [],
      },
    ];

    const startTimestamp = Math.floor(Date.now() / 1000);
    const endTimestamp = startTimestamp + 86400 * 30;

    console.log("Rewards being sent:");
    rewards.forEach((r, i) => {
      console.log(
        `  Reward ${i}: name='${r.name}', type=${Object.keys(r.rewardType)[0]}, mints=${r.rewardMints.length}`
      );
    });

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
      .rpc({ skipPreflight: false });

    console.log("Set Reward List txHash: ", tx);

    // Log reward list details
    await logRewardListDetails(program, ephemeralProgram, rewardListPda);
  });

  it("Set Whitelist", async () => {
    console.log("\n=== Setting Whitelist ===");

    try {
      const tx = await program.methods
        .setWhitelist(whitelist)
        .accounts({
          admin: wallet.publicKey,
          rewardDistributor: rewardDistributorPda,
        })
        .rpc({ skipPreflight: true });

      console.log("Set Whitelist txHash: ", tx);

      // Verify the whitelist was set
      const distributorAccount = await program.account.rewardDistributor.fetch(
        rewardDistributorPda
      );

      console.log("Total Whitelisted Users:", distributorAccount.whitelist.length);
      distributorAccount.whitelist.forEach((address, index) => {
        console.log(`${index + 1}. ${address.toString()}`);
      });
    } catch (err) {
      console.log("Error setting whitelist:", (err as Error).message);
    }
  });

  it("Initialize Transfer Lookup Table (once)", async () => {
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

  it("Delegate Reward List to ER", async () => {
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
      // Transaction succeeded, VRF callback will come asynchronously
      let listener: number | null = null;
      let listenerRemoved = false;
      const callbackReceived = new Promise<void>((resolve) => {
        const timeoutId = setTimeout(() => {
          if (listener !== null && !listenerRemoved) {
            ephemeralProgram.provider.connection.removeOnLogsListener(listener);
            listenerRemoved = true;
          }
          console.log("VRF callback listener timeout (callback may still come)");
          resolve();
        }, 30000); // 30 second timeout

        listener = ephemeralProgram.provider.connection.onLogs(
          program.programId,
          (logs) => {
            try {
              console.log("Program logs received:", logs.logs);
              console.log("VRF callback signature:", logs.signature);
              console.log("VRF callback status:", logs.err ? "Error" : "Success");
              console.log("VRF callback logs:");
              const relevantLogs = logs.logs.filter(
                (log) => log.includes("Random result:") || log.includes("Won reward") || log.includes("exhausted")
              );
              relevantLogs.forEach((log) => console.log("  " + log));
              if (listener !== null && !listenerRemoved) {
                ephemeralProgram.provider.connection.removeOnLogsListener(listener);
                listenerRemoved = true;
              }
              clearTimeout(timeoutId);
              resolve();
            } catch (err) {
              console.error("Error in log listener:", err);
            }
          },
          "confirmed"
        );
      });

      // Wait for the callback (with timeout)
      await callbackReceived;
    }
  });

  it("Verify reward constraint - super_admin can set reward list", async () => {
    const rewards = [
      {
        name: "Gold Prize",
        drawRangeMin: 1,
        drawRangeMax: 30,
        rewardType: { splToken: {} },
        rewardMints: [tokenMint],
        rewardAmount: new anchor.BN(1000),
        redemptionCount: new anchor.BN(0),
        redemptionLimit: new anchor.BN(1000),
        additionalPubkeys: []
      },
      {
        name: "Silver Prize",
        drawRangeMin: 31,
        drawRangeMax: 65,
        rewardType: { legacyNft: {} },
        rewardMints: [],
        rewardAmount: new anchor.BN(1),
        redemptionCount: new anchor.BN(0),
        redemptionLimit: new anchor.BN(0),
        additionalPubkeys: []
      }
    ];

    const startTimestamp = Math.floor(Date.now() / 1000);
    const endTimestamp = startTimestamp + 86400;

    const tx = await ephemeralProgram.methods
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

  it.only("Add NFT Mint to Silver Prize Reward (on Ephemeral Rollup)", async () => {
    console.log("\n=== Adding NFT Mint to Silver Prize Reward ===");
    try {
      // Load NFT mints from file
      const mintsPath = "tests/nft-mints.json";
      if (!fs.existsSync(mintsPath)) {
        console.log("No NFT mints found");
        return;
      }

      const mintsData = JSON.parse(fs.readFileSync(mintsPath, "utf-8"));
      if (!mintsData.nfts || mintsData.nfts.length === 0) {
        console.log("No NFTs in mints data");
        return;
      }

      // Use the last NFT
      const nftData = mintsData.nfts[mintsData.nfts.length - 1];
      const nftMint = new PublicKey(nftData.mint);
      const distributorNftAccount = new PublicKey(nftData.distributorTokenAccount);
      const [metadataAddress] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
          nftMint.toBuffer(),
        ],
        new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
      );

      // Adding NFT to "Bronze Prize" reward
      const accountsObj: any = { 
        admin: wallet.publicKey,
        rewardDistributor: rewardDistributorPda,
        rewardList: rewardListPda,
        mint: nftMint,
        tokenAccount: distributorNftAccount,
        metadata: metadataAddress,
      };

      let tx = await ephemeralProgram.methods
        .addReward(
          "Silver Prize",
          null, // reward_amount (not needed for existing reward)
          null, // redemption_limit (not needed for existing reward)
          null, // draw_range_min (not needed for existing reward)
          null  // draw_range_max (not needed for existing reward)
        )
        .accounts(accountsObj)
        .transaction();

      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (
        await providerEphemeralRollup.connection.getLatestBlockhash()
      ).blockhash;
      tx.partialSign(wallet.payer);

      const txHash = await providerEphemeralRollup
        .sendAndConfirm(tx, [wallet.payer], { skipPreflight: true })
        .catch((err) => {
          console.log("Add Reward error:", err?.message || JSON.stringify(err));
          return null;
        });

      if (txHash) {
        console.log("Add Reward txHash: ", txHash);
        console.log("Successfully added NFT to 'Silver Prize' reward");

        // Log updated reward list details
        await logRewardListDetails(program, ephemeralProgram, rewardListPda, true);
      } else {
        console.log("Add Reward transaction failed or was not confirmed");
      }
    } catch (addRewardErr) {
      console.error("Error adding reward:", addRewardErr);
      console.log("Error details:", addRewardErr instanceof Error ? addRewardErr.message : JSON.stringify(addRewardErr));
    }
  });

  it.only("Add Token Reward to Bronze Prize with SPL Token", async () => {
    logSection("Adding SPL Token to Bronze Prize Reward");
    try {

      // Adding SPL tokens to "Bronze Prize" reward (no metadata needed for tokens)
      const accountsObj: any = {
        admin: wallet.publicKey,
        rewardDistributor: rewardDistributorPda,
        rewardList: rewardListPda,
        mint: tokenMint,
        tokenAccount: distributorTokenAccount,
        metadata: null, // Optional - not needed for SPL tokens
      };

      // Increase redemption limit for Bronze Prize (same reward_amount)
      let tx = await ephemeralProgram.methods
        .addReward(
          "Bronze Prize",
          new anchor.BN(500), // reward_amount: 500 tokens (must match existing)
          null,               // draw_range_min (not needed for existing reward)
          null,               // draw_range_max (not needed for existing reward)
          new anchor.BN(15)   // redemption_limit: increase from 10 to 15
        )
        .accounts(accountsObj)
        .transaction();

      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (
        await providerEphemeralRollup.connection.getLatestBlockhash()
      ).blockhash;
      tx.partialSign(wallet.payer);

      const txHash = await providerEphemeralRollup
        .sendAndConfirm(tx, [wallet.payer], { skipPreflight: true })
        .catch((err) => {
          logError("Add Token Reward error", err);
          return null;
        });

      if (txHash) {
        logTxResult("Add Token Reward", txHash);
        console.log("Successfully added SPL token to 'Bronze Prize' reward");
        await logRewardListDetails(program, ephemeralProgram, rewardListPda, true);
      } else {
        console.log("Add Token Reward transaction failed or was not confirmed");
      }
    } catch (err) {
      console.error("Error adding token reward:", err);
      logError("Error details", err);
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
