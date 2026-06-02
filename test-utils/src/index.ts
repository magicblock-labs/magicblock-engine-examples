import type { web3 } from "@coral-xyz/anchor";
import {
  AccountMeta,
  Address as Web3Address,
  Blockhash,
  Signer,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { type SignatureBytes } from "@solana/keys";
import nacl from "tweetnacl";

export type AnchorPublicKey = Pick<web3.PublicKey, "toBuffer">;
export type AnchorAccountMeta = web3.AccountMeta;
export type AnchorInstruction = web3.TransactionInstruction;
export type AnchorTransaction = Pick<web3.Transaction, "instructions">;

export type AnchorKeypair = Pick<web3.Keypair, "publicKey" | "secretKey">;
export type MagicSvmAddress = Signer["address"];

export type MagicSvmTransactionOptions = {
  recentBlockhash: Blockhash;
  payer: Signer;
  signers?: Signer[];
};

export function publicKeyToMagicAddress(
  publicKey: AnchorPublicKey
): MagicSvmAddress {
  return new Web3Address(publicKey.toBuffer()).toBase58() as MagicSvmAddress;
}

export function keypairToMagicSigner(keypair: AnchorKeypair): Signer {
  const signerAddress = publicKeyToMagicAddress(keypair.publicKey);

  return {
    address: signerAddress,
    signTransactions: async (transactions) => {
      return transactions.map((tx) => ({
        [signerAddress as string]: nacl.sign.detached(
          new Uint8Array(tx.messageBytes),
          keypair.secretKey
        ) as SignatureBytes,
      }));
    },
  };
}

export function accountMetaToMagicAccountMeta(
  account: AnchorAccountMeta
): AccountMeta {
  return {
    pubkey: new Web3Address(account.pubkey.toBuffer()),
    isSigner: account.isSigner,
    isWritable: account.isWritable,
  };
}

export function instructionToMagicInstruction(
  instruction: AnchorInstruction
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new Web3Address(instruction.programId.toBuffer()),
    keys: instruction.keys.map(accountMetaToMagicAccountMeta),
    data: instruction.data,
  });
}

export async function transactionToMagicTransaction(
  anchorTransaction: AnchorTransaction,
  options: MagicSvmTransactionOptions
): Promise<Transaction> {
  const transaction = new Transaction();

  for (const instruction of anchorTransaction.instructions) {
    transaction.add(instructionToMagicInstruction(instruction));
  }

  transaction.feePayer = new Web3Address(options.payer.address);
  transaction.recentBlockhash = options.recentBlockhash;
  transaction.lastValidBlockHeight = 0n;

  for (const signer of options.signers ?? []) {
    await transaction.partialSign(signer);
  }
  await transaction.partialSign(options.payer);

  return transaction;
}
