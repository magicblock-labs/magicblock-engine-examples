import {
  AnchorProvider,
  Program,
  Wallet,
  web3,
  type Idl,
} from "@coral-xyz/anchor";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  FailedTransactionMetadata,
  MagicSVM,
  TransactionMetadata,
  type Address,
  type SendableTransaction,
  type TransactionTarget,
} from "@magicblock-labs/magicsvm";
import * as fs from "fs";
import * as path from "path";

export type { Address, TransactionTarget } from "@magicblock-labs/magicsvm";

export {
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  createCommitAndUndelegateInstruction,
  createCommitInstruction,
  createDelegateInstruction,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";

/**
 * Structural types so callers can pass `@solana/web3.js` v1 objects from any
 * copy (Anchor, an app workspace, MagicsVM). Nominal `Keypair` / `PublicKey`
 * types from nested installs are not compatible with each other.
 */
export type PublicKeyLike = {
  equals?(other: unknown): boolean;
  toBase58(): string;
  toBuffer(): Buffer | Uint8Array;
  toBytes(): Uint8Array;
  toString(): string;
};

export type SignerLike = {
  publicKey: PublicKeyLike;
  secretKey: Uint8Array;
};

export interface TransactionLike {
  feePayer?: unknown;
  recentBlockhash?: string | null;
  sign(...signers: SignerLike[]): unknown;
}

export type InstructionLike = {
  data: Buffer | Uint8Array;
  keys: Array<{
    isSigner: boolean;
    isWritable: boolean;
    pubkey: PublicKeyLike | Address;
  }>;
  programId: PublicKeyLike | Address;
};

export function addressToBase58(address: PublicKeyLike | Address): string {
  if (typeof address === "string") {
    return address;
  }
  if ("toBase58" in address && typeof address.toBase58 === "function") {
    return address.toBase58();
  }
  return new web3.PublicKey(Buffer.from(address.toBytes())).toBase58();
}

function asWeb3PublicKey(address: PublicKeyLike | Address): web3.PublicKey {
  if (address instanceof web3.PublicKey) {
    return address;
  }
  if (typeof address === "string") {
    return new web3.PublicKey(address);
  }
  if ("toBytes" in address) {
    return new web3.PublicKey(Buffer.from(address.toBytes()));
  }
  return new web3.PublicKey(addressToBase58(address));
}

function isFailedTransactionMetadata(
  result: unknown,
): result is FailedTransactionMetadata {
  // MagicsVM is loaded once per example and once from this package. `instanceof`
  // fails across those copies, so identify failures by constructor name.
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { constructor?: { name?: string } }).constructor?.name ===
      "FailedTransactionMetadata"
  );
}

export function failOnSvmError(
  result: unknown,
  label = "transaction",
): asserts result is Exclude<unknown, FailedTransactionMetadata> {
  if (isFailedTransactionMetadata(result)) {
    const logs = result.meta().logs().join("\n");
    throw new Error(`${label} failed: ${result.err()}\n${logs}`);
  }
}

function uniqueSigners(signers: SignerLike[]): SignerLike[] {
  const seen = new Set<string>();
  return signers.filter((signer) => {
    const key = addressToBase58(signer.publicKey);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function sendSvmTx(
  svm: MagicSVM,
  signers: SignerLike[],
  tx: TransactionLike,
  target: TransactionTarget = "base",
  label = "transaction",
): TransactionMetadata {
  const unique = uniqueSigners(signers);
  tx.feePayer = unique[0].publicKey;
  tx.recentBlockhash = svm.latestBlockhashFor({ target });
  tx.sign(...unique);
  const result = svm.sendTransaction(tx as unknown as SendableTransaction, {
    target,
  });
  failOnSvmError(result, label);
  svm.expireBlockhashFor({ target });
  return result as TransactionMetadata;
}

function toWeb3Instruction(ix: InstructionLike): web3.TransactionInstruction {
  return new web3.TransactionInstruction({
    data: Buffer.from(ix.data),
    keys: ix.keys.map((key) => ({
      isSigner: key.isSigner,
      isWritable: key.isWritable,
      pubkey: asWeb3PublicKey(key.pubkey),
    })),
    programId: asWeb3PublicKey(ix.programId),
  });
}

export function sendSvmIx(
  svm: MagicSVM,
  signers: SignerLike[],
  instructions: InstructionLike | InstructionLike[],
  target: TransactionTarget = "base",
  label = "transaction",
): TransactionMetadata {
  const ixs = Array.isArray(instructions) ? instructions : [instructions];
  return sendSvmTx(
    svm,
    signers.map((signer) => web3.Keypair.fromSecretKey(signer.secretKey)),
    new web3.Transaction().add(...ixs.map(toWeb3Instruction)),
    target,
    label,
  );
}

export function sendExpectingFailure(
  svm: MagicSVM,
  signers: SignerLike[],
  instructions: InstructionLike | InstructionLike[],
  target: TransactionTarget = "base",
): FailedTransactionMetadata {
  const ixs = Array.isArray(instructions) ? instructions : [instructions];
  const unique = uniqueSigners(signers);
  const tx = new web3.Transaction().add(...ixs.map(toWeb3Instruction));
  tx.feePayer = asWeb3PublicKey(unique[0].publicKey);
  tx.recentBlockhash = svm.latestBlockhashFor({ target });
  tx.sign(
    ...unique.map((signer) => web3.Keypair.fromSecretKey(signer.secretKey)),
  );
  const result = svm.sendTransaction(tx, { target });
  svm.expireBlockhashFor({ target });
  if (!isFailedTransactionMetadata(result)) {
    throw new Error("expected transaction to fail");
  }
  return result;
}

export function requireAccount(
  svm: MagicSVM,
  address: PublicKeyLike | Address,
  target: TransactionTarget = "base",
  label?: string,
) {
  const account = svm.getAccountFor(addressToBase58(address), { target });
  if (!account.exists) {
    throw new Error(
      `expected ${label ?? addressToBase58(address)} to exist on ${target}`,
    );
  }
  return account;
}

export function airdropOrThrow(
  svm: MagicSVM,
  address: PublicKeyLike | Address,
  lamports: bigint,
  label = "airdrop",
): void {
  failOnSvmError(svm.airdrop(addressToBase58(address), lamports), label);
}

export function programIdFromKeypairFile(keypairPath: string): string {
  const secretKeyArray = Uint8Array.from(
    JSON.parse(fs.readFileSync(keypairPath, "utf8")),
  );
  return web3.Keypair.fromSecretKey(secretKeyArray).publicKey.toBase58();
}

export function loadJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function programSoPath(fromDir: string, programName: string): string {
  return path.resolve(fromDir, "..", "target", "deploy", `${programName}.so`);
}

export function programIdlPath(fromDir: string, programName: string): string {
  return path.resolve(fromDir, "..", "target", "idl", `${programName}.json`);
}

export function dummyAnchorProvider(payer: SignerLike): AnchorProvider {
  return new AnchorProvider(
    new web3.Connection("http://127.0.0.1:8899"),
    new Wallet(web3.Keypair.fromSecretKey(payer.secretKey)),
    { commitment: "confirmed" },
  );
}

export function loadAnchorProgram<T extends Idl>(
  idl: T,
  payer: SignerLike,
): Program<T> {
  return new Program(idl, dummyAnchorProvider(payer));
}

export function validatorPubkey(svm: MagicSVM): string {
  return addressToBase58(svm.validatorIdentity());
}

export function validatorRemainingAccount(svm: MagicSVM): {
  pubkey: web3.PublicKey;
  isSigner: false;
  isWritable: false;
} {
  return {
    pubkey: new web3.PublicKey(validatorPubkey(svm)),
    isSigner: false,
    isWritable: false,
  };
}

export function readU64le(
  svm: MagicSVM,
  address: PublicKeyLike | Address,
  target: TransactionTarget = "base",
  offset = 8,
): bigint {
  return Buffer.from(requireAccount(svm, address, target).data).readBigUInt64LE(
    offset,
  );
}

export function accountOwner(
  svm: MagicSVM,
  address: PublicKeyLike | Address,
  target: TransactionTarget = "base",
): string {
  return requireAccount(svm, address, target).programAddress.toString();
}

export function isDelegated(
  svm: MagicSVM,
  address: PublicKeyLike | Address,
  target: TransactionTarget = "base",
): boolean {
  const account = svm.getAccountFor(addressToBase58(address), { target });
  return (
    account.exists &&
    account.programAddress.toString() === DELEGATION_PROGRAM_ID.toString()
  );
}

export function setUnixTimestamp(
  svm: MagicSVM,
  unix: bigint | number = Math.floor(Date.now() / 1000),
): void {
  const clock = svm.getClock();
  clock.unixTimestamp = BigInt(unix);
  svm.setClock(clock);
}

export function createSvm(opts: {
  programs: Array<{ id: PublicKeyLike | Address; so: string }>;
  airdrops?: Array<{
    address: PublicKeyLike | Address;
    lamports: bigint;
    label?: string;
  }>;
}): { svm: MagicSVM; validator: string } {
  const svm = new MagicSVM();
  for (const program of opts.programs) {
    svm.addProgramFromFile(addressToBase58(program.id), program.so);
  }
  for (const drop of opts.airdrops ?? []) {
    airdropOrThrow(svm, drop.address, drop.lamports, drop.label);
  }
  return { svm, validator: validatorPubkey(svm) };
}

export function bootAnchorSvm<T extends Idl>(opts: {
  fromDir: string;
  programName: string;
  payer?: SignerLike;
  airdropLamports?: bigint;
  extraPrograms?: Array<{ id: PublicKeyLike | Address; so: string }>;
  idl?: T;
}): {
  svm: MagicSVM;
  payer: web3.Keypair;
  program: Program<T>;
  validator: string;
} {
  const payer = opts.payer
    ? web3.Keypair.fromSecretKey(opts.payer.secretKey)
    : web3.Keypair.generate();
  const idl =
    opts.idl ?? (loadJson(programIdlPath(opts.fromDir, opts.programName)) as T);
  const program = loadAnchorProgram(idl, payer);
  const { svm, validator } = createSvm({
    programs: [
      {
        id: program.programId,
        so: programSoPath(opts.fromDir, opts.programName),
      },
      ...(opts.extraPrograms ?? []),
    ],
    airdrops:
      opts.airdropLamports == null
        ? undefined
        : [
            {
              address: payer.publicKey,
              lamports: opts.airdropLamports,
            },
          ],
  });
  return { svm, payer, program, validator };
}
