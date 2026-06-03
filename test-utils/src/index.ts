import type { web3 } from "@coral-xyz/anchor";
import {
  AccountMeta,
  Address,
  Blockhash,
  Signer,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { type SignatureBytes } from "@solana/keys";
import nacl from "tweetnacl";
import { AccountRole, TransactionMessage } from "@solana/kit";

export type MagicSvmTransactionOptions = {
  recentBlockhash: Blockhash;
  payer: Signer;
  signers?: Signer[];
};

export function addressFromWeb3PublicKey(publicKey: web3.PublicKey): Address {
  return new Address(publicKey.toBuffer());
}

export function signerFromWeb3Keypair(keypair: web3.Keypair): Signer {
  const signerAddress = addressFromWeb3PublicKey(keypair.publicKey);

  return {
    address: signerAddress.toBase58(),
    signTransactions: async (transactions) => {
      return transactions.map((tx) => ({
        [signerAddress.toBase58() as string]: nacl.sign.detached(
          new Uint8Array(tx.messageBytes),
          keypair.secretKey,
        ) as SignatureBytes,
      }));
    },
  };
}

export function accountMetaFromWeb3AccountMeta(
  account: web3.AccountMeta,
): AccountMeta {
  return {
    pubkey: new Address(account.pubkey.toBuffer()),
    isSigner: account.isSigner,
    isWritable: account.isWritable,
  };
}

export function instructionFromWeb3Instruction(
  instruction: web3.TransactionInstruction,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new Address(instruction.programId.toBuffer()),
    keys: instruction.keys.map(accountMetaFromWeb3AccountMeta),
    data: instruction.data,
  });
}

export async function transactionFromWeb3Transaction(
  tx: web3.Transaction,
  options: MagicSvmTransactionOptions,
): Promise<Transaction> {
  const transaction = new Transaction();

  for (const instruction of tx.instructions) {
    transaction.add(instructionFromWeb3Instruction(instruction));
  }

  transaction.feePayer = new Address(options.payer.address);
  transaction.recentBlockhash = options.recentBlockhash;
  transaction.lastValidBlockHeight = 0n;

  for (const signer of options.signers ?? []) {
    await transaction.partialSign(signer);
  }
  await transaction.partialSign(options.payer);

  return transaction;
}

export async function transactionFromKitTransactionMessage(
  msg: TransactionMessage,
  options: MagicSvmTransactionOptions,
): Promise<Transaction> {
  const transaction = new Transaction();

  for (const instruction of msg.instructions) {
    transaction.add({
      programId: new Address(instruction.programAddress),
      keys: (instruction.accounts || []).map((account) => ({
        pubkey: new Address(account.address),
        isSigner:
          account.role === AccountRole.READONLY_SIGNER ||
          account.role === AccountRole.WRITABLE_SIGNER,
        isWritable:
          account.role === AccountRole.WRITABLE ||
          account.role === AccountRole.WRITABLE_SIGNER,
      })),
      data: new Uint8Array(instruction.data || []),
    });
  }

  transaction.feePayer = new Address(options.payer.address);
  transaction.recentBlockhash = options.recentBlockhash;
  transaction.lastValidBlockHeight = 0n;

  for (const signer of options.signers ?? []) {
    await transaction.partialSign(signer);
  }
  await transaction.partialSign(options.payer);

  return transaction;
}
