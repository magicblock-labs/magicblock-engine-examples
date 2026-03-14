import * as anchor from "@coral-xyz/anchor";
import * as fs from "fs";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AIRDROP_AMOUNT_SOL, MIN_BALANCE_SOL } from "./constants";

/**
 * Load or generate user keypair from file
 */
export function loadOrGenerateUserKeypair(
  userKeypairPath: string
): anchor.web3.Keypair {
  let user: anchor.web3.Keypair;

  if (fs.existsSync(userKeypairPath)) {
    const userKeypairData = JSON.parse(
      fs.readFileSync(userKeypairPath, "utf-8")
    );
    user = anchor.web3.Keypair.fromSecretKey(
      new Uint8Array(userKeypairData.secretKey)
    );
    console.log("Loaded user keypair from", userKeypairPath);
  } else {
    user = anchor.web3.Keypair.generate();
    const userKeypairData = {
      secretKey: Array.from(user.secretKey),
    };
    fs.writeFileSync(userKeypairPath, JSON.stringify(userKeypairData, null, 2));
    console.log("Generated and saved new user keypair to", userKeypairPath);
  }

  return user;
}

/**
 * Airdrop SOL to test accounts if balance is insufficient
 */
export async function ensureUserBalance(
  provider: anchor.AnchorProvider,
  user: anchor.web3.Keypair
): Promise<void> {
  try {
    const userBalance = await provider.connection.getBalance(user.publicKey);
    if (userBalance < MIN_BALANCE_SOL * LAMPORTS_PER_SOL) {
      try {
        const airdropSig = await provider.connection.requestAirdrop(
          user.publicKey,
          AIRDROP_AMOUNT_SOL * LAMPORTS_PER_SOL
        );
        const confirmation = await provider.connection.confirmTransaction(
          airdropSig,
          "confirmed"
        );
        if (confirmation.value.err) {
          console.log("Airdrop failed:", confirmation.value.err);
        } else {
          console.log(
            `Airdropped ${AIRDROP_AMOUNT_SOL} SOL to user:`,
            user.publicKey.toString()
          );
        }
      } catch (airdropErr) {
        console.log("Airdrop request failed (network may not support airdrops):", airdropErr instanceof Error ? airdropErr.message : airdropErr);
        console.log("Note: Ensure user has sufficient SOL before running tests");
      }
    } else {
      console.log(
        "User already has sufficient balance:",
        userBalance / LAMPORTS_PER_SOL,
        "SOL -",
        user.publicKey.toString()
      );
    }
  } catch (e) {
    console.log("Balance check failed:", e instanceof Error ? e.message : e);
  }

  // Log final user balance
  const finalBalance = await provider.connection.getBalance(user.publicKey);
  console.log("User balance:", finalBalance / LAMPORTS_PER_SOL, "SOL\n");
  
  if (finalBalance === 0) {
    console.log("WARNING: User has 0 SOL. Tests may fail. Fund the account manually:");
    console.log(`  solana airdrop 2 ${user.publicKey.toString()}`);
  }
}

/**
 * Save mints data to JSON file
 */
export function saveMints(mintsPath: string, data: any): void {
  fs.writeFileSync(mintsPath, JSON.stringify(data, null, 2));
  console.log("Saved NFT mints to", mintsPath);
}
