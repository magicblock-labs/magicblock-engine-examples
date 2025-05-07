import * as anchor from "@coral-xyz/anchor";
import { TokenMinter } from "../target/types/token_minter";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

describe("NFT Minter", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = provider.wallet as anchor.Wallet;
  const program = anchor.workspace.TokenMinter as anchor.Program<TokenMinter>;

  const [mintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint")],
    program.programId
  );

  const metadata = {
    name: "Magical Gem",
    symbol: "MBGEM",
    uri: "https://shdw-drive.genesysgo.net/4PMP1MG5vYGkT7gnAMb7E5kqPLLjjDzTiAaZ3xRx5Czd/gem.json",
  };

  it("Create a token!", async () => {
    const accountInfo = await provider.connection.getAccountInfo(
      mintPDA
    );

    if (accountInfo) {
      console.log("Token account already exists. Skipping creation.");
      return; // Skip token creation if the account already exists.
    }

    const transactionSignature = await program.methods
      .createToken(metadata.name, metadata.symbol, metadata.uri)
      .accounts({
        payer: payer.publicKey,
      })
      .rpc();

    console.log("Success!");
    console.log(`   Mint Address: ${mintPDA}`);
    console.log(`   Transaction Signature: ${transactionSignature}`);
  });

  it("Mint 1 Token for player", async () => {
    // Derive the associated token address account for the mint and payer.
    const associatedTokenAccountAddress = getAssociatedTokenAddressSync(
      mintPDA,
      payer.publicKey
    );

    // Amount of tokens to mint.
    const amount = new anchor.BN(1);

    const transactionSignature = await program.methods
      .mintToken(amount)
      .accounts({
        payer: payer.publicKey,
        counter: new PublicKey("5RgeA5P8bRaynJovch3zQURfJxXL3QK2JYg1YamSvyLb"),
      })
      .rpc();

    console.log("Success!");
    console.log(
      `   Associated Token Account Address: ${associatedTokenAccountAddress}`
    );
    console.log(`   Transaction Signature: ${transactionSignature}`);

    // Fetch the transaction info to get the program logs.
    const txInfo = await provider.connection.getTransaction(transactionSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 1,
    });
    console.log("Program Logs:");
    console.log(txInfo?.meta?.logMessages?.join("\n"));
  });
});
