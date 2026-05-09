import { Connection, PublicKey, Transaction, Keypair } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  createCreateMasterEditionV3Instruction,
  createCreateMetadataAccountV3Instruction,
  createSetAndVerifySizedCollectionItemInstruction,
  createUpdateMetadataAccountV2Instruction,
} from "@metaplex-foundation/mpl-token-metadata";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

function deriveMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  )[0];
}

function deriveMasterEditionPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID
  )[0];
}

/**
 * Build a transaction that creates a new NFT collection mint.
 * Returns the transaction AND the generated mint keypair — caller must
 * partialSign with the keypair before the wallet adapter signs.
 */
export async function buildMintNftCollection(
  connection: Connection,
  publicKey: PublicKey,
  name: string,
  symbol: string,
  uri: string
): Promise<{ tx: Transaction; mintKeypair: Keypair }> {
  const mintKeypair = Keypair.generate();
  const mintRent = await connection.getMinimumBalanceForRentExemption(82);
  const ownerTokenAccount = getAssociatedTokenAddressSync(mintKeypair.publicKey, publicKey);
  const metadataAddress = deriveMetadataPda(mintKeypair.publicKey);
  const masterEditionAddress = deriveMasterEditionPda(mintKeypair.publicKey);

  const tx = new Transaction()
    .add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: 82,
        lamports: mintRent,
        programId: TOKEN_PROGRAM_ID,
      })
    )
    .add(createInitializeMintInstruction(mintKeypair.publicKey, 0, publicKey, publicKey, TOKEN_PROGRAM_ID))
    .add(createAssociatedTokenAccountInstruction(publicKey, ownerTokenAccount, publicKey, mintKeypair.publicKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID))
    .add(createMintToInstruction(mintKeypair.publicKey, ownerTokenAccount, publicKey, 1, [], TOKEN_PROGRAM_ID))
    .add(
      createCreateMetadataAccountV3Instruction(
        {
          metadata: metadataAddress,
          mint: mintKeypair.publicKey,
          mintAuthority: publicKey,
          payer: publicKey,
          updateAuthority: publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        {
          createMetadataAccountArgsV3: {
            data: {
              name,
              symbol,
              uri,
              sellerFeeBasisPoints: 0,
              creators: [{ address: publicKey, verified: true, share: 100 }],
              collection: null,
              uses: null,
            },
            isMutable: true,
            collectionDetails: { __kind: "V1", size: new anchor.BN(0) },
          },
        }
      )
    )
    .add(
      createCreateMasterEditionV3Instruction(
        {
          edition: masterEditionAddress,
          metadata: metadataAddress,
          mint: mintKeypair.publicKey,
          mintAuthority: publicKey,
          payer: publicKey,
          updateAuthority: publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        { createMasterEditionArgs: { maxSupply: new anchor.BN(0) } }
      )
    );

  return { tx, mintKeypair };
}

/**
 * Build a transaction that mints an NFT into an existing collection.
 * Returns the transaction AND the generated mint keypair.
 */
export async function buildMintNftToCollection(
  connection: Connection,
  publicKey: PublicKey,
  collectionMint: PublicKey,
  name: string,
  symbol: string,
  uri: string
): Promise<{ tx: Transaction; mintKeypair: Keypair }> {
  const mintKeypair = Keypair.generate();
  const mintRent = await connection.getMinimumBalanceForRentExemption(82);
  const ownerTokenAccount = getAssociatedTokenAddressSync(mintKeypair.publicKey, publicKey);
  const metadataAddress = deriveMetadataPda(mintKeypair.publicKey);
  const masterEditionAddress = deriveMasterEditionPda(mintKeypair.publicKey);
  const collectionMetadataAddress = deriveMetadataPda(collectionMint);
  const collectionMasterEditionAddress = deriveMasterEditionPda(collectionMint);

  const tx = new Transaction()
    .add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: 82,
        lamports: mintRent,
        programId: TOKEN_PROGRAM_ID,
      })
    )
    .add(createInitializeMintInstruction(mintKeypair.publicKey, 0, publicKey, publicKey, TOKEN_PROGRAM_ID))
    .add(createAssociatedTokenAccountInstruction(publicKey, ownerTokenAccount, publicKey, mintKeypair.publicKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID))
    .add(createMintToInstruction(mintKeypair.publicKey, ownerTokenAccount, publicKey, 1, [], TOKEN_PROGRAM_ID))
    .add(
      createCreateMetadataAccountV3Instruction(
        {
          metadata: metadataAddress,
          mint: mintKeypair.publicKey,
          mintAuthority: publicKey,
          payer: publicKey,
          updateAuthority: publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        {
          createMetadataAccountArgsV3: {
            data: {
              name,
              symbol,
              uri,
              sellerFeeBasisPoints: 0,
              creators: [{ address: publicKey, verified: true, share: 100 }],
              collection: { key: collectionMint, verified: false },
              uses: null,
            },
            isMutable: true,
            collectionDetails: null,
          },
        }
      )
    )
    .add(
      createCreateMasterEditionV3Instruction(
        {
          edition: masterEditionAddress,
          metadata: metadataAddress,
          mint: mintKeypair.publicKey,
          mintAuthority: publicKey,
          payer: publicKey,
          updateAuthority: publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        { createMasterEditionArgs: { maxSupply: null } }
      )
    )
    .add(
      createSetAndVerifySizedCollectionItemInstruction({
        metadata: metadataAddress,
        collectionAuthority: publicKey,
        payer: publicKey,
        updateAuthority: publicKey,
        collectionMint,
        collection: collectionMetadataAddress,
        collectionMasterEditionAccount: collectionMasterEditionAddress,
      } as any)
    );

  return { tx, mintKeypair };
}

/**
 * Build a transaction that updates NFT metadata.
 * Synchronous — no on-chain reads required.
 */
export function buildUpdateNftMetadata(
  publicKey: PublicKey,
  mint: PublicKey,
  name: string,
  symbol: string,
  uri: string
): Transaction {
  const metadataAddress = deriveMetadataPda(mint);
  return new Transaction().add(
    createUpdateMetadataAccountV2Instruction(
      { metadata: metadataAddress, updateAuthority: publicKey },
      {
        updateMetadataAccountArgsV2: {
          data: {
            name,
            symbol,
            uri,
            sellerFeeBasisPoints: 0,
            creators: [{ address: publicKey, verified: true, share: 100 }],
            collection: null,
            uses: null,
          },
          updateAuthority: publicKey,
          primarySaleHappened: null,
          isMutable: null,
        },
      }
    )
  );
}
