// One-time devnet setup: create a tip jar and delegate it to the ER.
//
// This is the only step that needs SOL, so the developer runs it with their
// Solana CLI wallet. Users of the app never need SOL.
//
//   yarn create-jar                    # jar owned by your CLI wallet
//   yarn create-jar <keypair.json>     # jar owned by another wallet, e.g. the
//                                      # app's embedded wallet ("Export key"),
//                                      # so you can collect tips in the app
//
// The authority signs too, so nobody can create a jar for a wallet they don't own.
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  delegateEphemeralAtaIx,
  deriveEphemeralAta,
  initEphemeralAtaIx,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import idl from "../target/idl/tip_jar.json";
import type { TipJar } from "../target/types/tip_jar";

const RPC = process.env.RPC_URL ?? "https://rpc.magicblock.app/devnet";
// Must match the app's config: deposits land on this validator.
const VALIDATOR = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

const loadKeypair = (path: string) =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );

async function main() {
  // Pays for setup. Defaults to the Solana CLI wallet.
  const wallet = new anchor.Wallet(
    loadKeypair(
      process.env.ANCHOR_WALLET ?? `${homedir()}/.config/solana/id.json`,
    ),
  );
  const provider = new anchor.AnchorProvider(
    new Connection(RPC, "confirmed"),
    wallet,
  );
  const program = new Program<TipJar>(idl as TipJar, provider);
  const authority = process.argv[2]
    ? loadKeypair(process.argv[2])
    : wallet.payer;
  const [jar] = PublicKey.findProgramAddressSync(
    [Buffer.from("jar"), authority.publicKey.toBuffer()],
    program.programId,
  );

  if (await provider.connection.getAccountInfo(jar)) {
    console.log(`Jar already exists: ${jar.toBase58()}`);
    return;
  }

  const [jarEata] = deriveEphemeralAta(jar, USDC_MINT);
  const tx = new Transaction().add(
    // 1. The jar account plus its USDC token account.
    await program.methods
      .createJar(VALIDATOR)
      .accountsPartial({
        payer: wallet.publicKey,
        authority: authority.publicKey,
        jar,
        mint: USDC_MINT,
        jarToken: getAssociatedTokenAddressSync(USDC_MINT, jar, true),
      })
      .instruction(),
    // 2. Delegate the jar's ephemeral ATA so its token account is writable on the ER.
    initEphemeralAtaIx(jarEata, jar, USDC_MINT, wallet.publicKey),
    delegateEphemeralAtaIx(wallet.publicKey, jarEata, VALIDATOR),
    // 3. Delegate the jar itself so `tip` can update its totals on the ER.
    await program.methods
      .delegateJar()
      .accountsPartial({ payer: wallet.publicKey, jar })
      .instruction(),
  );
  const signature = await provider.sendAndConfirm(tx, [authority]);

  console.log(
    `Created jar ${jar.toBase58()} (authority ${authority.publicKey.toBase58()})`,
  );
  console.log(
    `Transaction: https://explorer.solana.com/tx/${signature}?cluster=devnet`,
  );
  console.log(`\nAdd this to app/.env:\nVITE_JAR_ADDRESS=${jar.toBase58()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
