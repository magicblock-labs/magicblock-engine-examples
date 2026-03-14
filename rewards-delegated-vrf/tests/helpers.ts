import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import { RewardsDelegatedVrf } from "../target/types/rewards_delegated_vrf";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { MPL_TOKEN_AUTH_RULES_PROGRAM_ID } from "@metaplex-foundation/mpl-token-auth-rules";
import { SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import {
  REWARD_LIST_SEED,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  BPF_UPGRADEABLE_LOADER,
} from "./constants";

/**
 * Get or create an associated token account for a PDA
 */
export async function getOrCreateDistributorTokenAccount(
  provider: anchor.AnchorProvider,
  tokenMint: PublicKey,
  rewardDistributorPda: PublicKey,
  payer: anchor.web3.Keypair
): Promise<PublicKey> {
  const distributorTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    rewardDistributorPda,
    true // allowOffCurve - allows PDAs
  );

  console.log(
    "Derived token account address for distributor PDA:",
    distributorTokenAccount.toString()
  );

  const accountInfo = await provider.connection.getAccountInfo(
    distributorTokenAccount
  );

  if (!accountInfo) {
    console.log("Creating token account for distributor PDA...");

    const createAccountTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey, // payer
        distributorTokenAccount, // associated token account
        rewardDistributorPda, // owner
        tokenMint, // mint
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    const createAccountSig = await provider.sendAndConfirm(createAccountTx);
    console.log("Token account created. Signature:", createAccountSig);
  } else {
    console.log("Token account already exists");
  }

  return distributorTokenAccount;
}

/**
 * Get the program data account for a program
 */
export function getProgramDataPda(programId: PublicKey): PublicKey {
  const [programData] = anchor.web3.PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_UPGRADEABLE_LOADER
  );
  return programData;
}

/**
 * Build the list of lookup accounts for transfer operations
 */
export function getTransferLookupAccounts(): PublicKey[] {
  return [
    // For SPL Token and Legacy NFT
    new PublicKey(TOKEN_PROGRAM_ID),
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
    new PublicKey(anchor.web3.SystemProgram.programId),
    // Additional for programmable NFT
    new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID),
    new PublicKey(SYSVAR_INSTRUCTIONS_PUBKEY),
    new PublicKey(MPL_TOKEN_AUTH_RULES_PROGRAM_ID),
  ];
}

/**
 * Log detailed reward list and distributor information
 */
export async function logRewardListDetails(
  program: Program<RewardsDelegatedVrf>,
  ephemeralProgram: Program<RewardsDelegatedVrf>,
  rewardListAddress: PublicKey,
  useEphemeral: boolean = false
): Promise<void> {
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
      console.log(
        "Admins:",
        distributorAccount.admins.map((a) => a.toString()).join(", ")
      );
    }

    console.log("\n=== Reward List Details ===");
    console.log("Distributor:", rewardListAccount.rewardDistributor.toString());
    console.log(
      "Start Timestamp:",
      rewardListAccount.startTimestamp.toNumber(),
      `(${new Date(
        rewardListAccount.startTimestamp.toNumber() * 1000
      ).toISOString()})`
    );
    console.log(
      "End Timestamp:",
      rewardListAccount.endTimestamp.toNumber(),
      `(${new Date(
        rewardListAccount.endTimestamp.toNumber() * 1000
      ).toISOString()})`
    );
    console.log("Global Range Min:", rewardListAccount.globalRangeMin);
    console.log("Global Range Max:", rewardListAccount.globalRangeMax);
    console.log("Total Reward Count:", rewardListAccount.rewards.length);

    console.log("\n=== Individual Rewards ===");
    rewardListAccount.rewards.forEach((reward, index) => {
      const redemptionCount =
        typeof reward.redemptionCount === "object"
          ? reward.redemptionCount.toNumber()
          : reward.redemptionCount;
      const redemptionLimit =
        typeof reward.redemptionLimit === "object"
          ? reward.redemptionLimit.toNumber()
          : reward.redemptionLimit;
      const amount =
        typeof reward.rewardAmount === "object"
          ? reward.rewardAmount.toNumber()
          : reward.rewardAmount;

      console.log(`\nReward ${index + 1}: ${reward.name}`);
      console.log(
        `  Draw Range: ${reward.drawRangeMin} - ${reward.drawRangeMax}`
      );
      console.log(`  Reward Type: ${Object.keys(reward.rewardType)[0]}`);
      console.log(
        `  Mints: ${reward.rewardMints.map((m) => m.toString()).join(", ")}`
      );
      console.log(`  Amount: ${amount}`);
      console.log(
        `  Redemption Count: ${redemptionCount}/${redemptionLimit}`
      );
    });
  } catch (err) {
    console.log(
      "Could not fetch reward list details:",
      (err as Error).message
    );
  }
}

/**
 * Get validator account for localhost testing
 */
export function getValidatorAccounts(rpcEndpoint: string): any[] {
  if (
    rpcEndpoint.includes("localhost") ||
    rpcEndpoint.includes("127.0.0.1")
  ) {
    return [
      {
        pubkey: new web3.PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"),
        isSigner: false,
        isWritable: false,
      },
    ];
  }
  return [];
}

/**
 * Log test environment setup
 */
export function logTestEnvironment(
  basLayerEndpoint: string,
  ephemeralEndpoint: string,
  adminKey: PublicKey,
  userKey: PublicKey,
  rewardDistributorPda: PublicKey,
  rewardListPda: PublicKey
): void {
  console.log("Base Layer Connection: ", basLayerEndpoint);
  console.log("Ephemeral Rollup Connection: ", ephemeralEndpoint);
  console.log(`Current SOL Public Key (Admin): ${adminKey}`);
  console.log(`Test User Public Key: ${userKey}`);
  console.log("Reward Distributor PDA: ", rewardDistributorPda.toString());
  console.log("Reward List PDA: ", rewardListPda.toString());
}

/**
 * Log section header
 */
export function logSection(title: string): void {
  console.log(`\n=== ${title} ===`);
}

/**
 * Log transaction result
 */
export function logTxResult(title: string, txHash: string | null): void {
  if (txHash) {
    console.log(`${title} txHash: ${txHash}`);
  } else {
    console.log(`${title} failed or was not confirmed`);
  }
}

/**
 * Log error with context
 */
export function logError(context: string, error: any): void {
  console.log(`${context}:`, error?.message || JSON.stringify(error));
}
