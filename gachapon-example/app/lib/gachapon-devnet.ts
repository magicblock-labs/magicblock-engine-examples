import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";

export const DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey(
  "H7J1Ec8qibE13iajhAEK5jjRvgFxnZCUes7UjQqFiirj",
);
export const MPL_CORE_PROGRAM_ID = new PublicKey(
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
);
export const VRF_PROGRAM_ID = new PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
);
export const DEFAULT_VRF_QUEUE = new PublicKey(
  "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
);
export const SLOT_HASHES = new PublicKey(
  "SysvarS1otHashes111111111111111111111111111",
);

export const REWARDS = [
  {
    weight: 55,
    name: "Bronze Capsule",
    uri: "https://example.com/gachapon/bronze.json",
  },
  {
    weight: 30,
    name: "Silver Capsule",
    uri: "https://example.com/gachapon/silver.json",
  },
  {
    weight: 12,
    name: "Gold Capsule",
    uri: "https://example.com/gachapon/gold.json",
  },
  {
    weight: 3,
    name: "Mythic Capsule",
    uri: "https://example.com/gachapon/mythic.json",
  },
] as const;

export type RewardTemplate = (typeof REWARDS)[number];

export type GachaponAccounts = {
  machineId: bigint;
  machine: PublicKey;
  treasury: PublicKey;
  updateAuthority: PublicKey;
  callbackIdentity: PublicKey;
  pendingPull: PublicKey;
  asset: PublicKey;
  pullId: bigint;
};

export type MachineAccount = {
  authority: PublicKey;
  machineId: bigint;
  totalWeight: number;
  pullCount: bigint;
  rewards: Array<{
    rewardId: number;
    weight: number;
    mintedCount: bigint;
    name: string;
    uri: string;
  }>;
};

export type PendingPullAccount = {
  machine: PublicKey;
  player: PublicKey;
  asset: PublicKey;
  pullId: bigint;
  rewardId: number;
  status: number;
};

export type CoreAssetAccount = {
  owner: PublicKey;
  updateAuthority: PublicKey | null;
  name: string;
  uri: string;
  attributes: Map<string, string>;
};

export type BrowserWallet = {
  isPhantom?: boolean;
  publicKey?: PublicKey;
  connect: () => Promise<{ publicKey: PublicKey }>;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
  signAndSendTransaction?: (
    transaction: Transaction,
  ) => Promise<{ signature: string }>;
};

type Cursor = {
  offset: number;
};

const MACHINE_SEED = "machine";
const TREASURY_SEED = "treasury";
const UPDATE_AUTHORITY_SEED = "update_authority";
const VRF_IDENTITY_SEED = "identity";
const PULL_SEED = "pull";
const ASSET_SEED = "asset";

const INIT_DISCRIMINATOR = [220, 59, 207, 236, 108, 250, 47, 100];
const UPLOAD_CONFIG_DISCRIMINATOR = [89, 32, 45, 158, 27, 66, 0, 213];
const PULL_DISCRIMINATOR = [78, 119, 161, 115, 9, 167, 75, 125];

const MACHINE_DISCRIMINATOR = [25, 102, 22, 13, 58, 243, 138, 79];
const PENDING_PULL_DISCRIMINATOR = [97, 135, 113, 202, 214, 223, 118, 91];
const PULL_STATUS_SETTLED = 1;
const ASSET_V1_KEY = 1;
const PLUGIN_HEADER_V1_KEY = 3;
const PLUGIN_REGISTRY_V1_KEY = 4;
const ATTRIBUTES_PLUGIN_TYPE = 6;

export function devnetConnection() {
  return new Connection(DEVNET_RPC_URL, "confirmed");
}

export function explorerAddress(address: PublicKey | string) {
  return `https://explorer.solana.com/address/${address.toString()}?cluster=devnet`;
}

export function explorerTx(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function shortKey(value: PublicKey | string) {
  const text = value.toString();
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function findGachaponAccounts(
  player: PublicKey,
  machineId = BigInt(Date.now()),
  pullId = 1n,
): GachaponAccounts {
  const machine = findPda([
    stringSeed(MACHINE_SEED),
    player.toBuffer(),
    u64Le(machineId),
  ]);

  return {
    machineId,
    machine,
    treasury: findPda([stringSeed(TREASURY_SEED), machine.toBuffer()]),
    updateAuthority: findPda([
      stringSeed(UPDATE_AUTHORITY_SEED),
      machine.toBuffer(),
    ]),
    callbackIdentity: findPda([stringSeed(VRF_IDENTITY_SEED)]),
    pendingPull: findPda([
      stringSeed(PULL_SEED),
      machine.toBuffer(),
      player.toBuffer(),
      u64Le(pullId),
    ]),
    asset: findPda([
      stringSeed(ASSET_SEED),
      machine.toBuffer(),
      player.toBuffer(),
      u64Le(pullId),
    ]),
    pullId,
  };
}

export function buildInitInstruction(
  player: PublicKey,
  accounts: GachaponAccounts,
) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: player, isSigner: true, isWritable: true },
      { pubkey: accounts.machine, isSigner: false, isWritable: true },
      { pubkey: accounts.treasury, isSigner: false, isWritable: true },
      { pubkey: accounts.updateAuthority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concatBuffers(
      Buffer.from(INIT_DISCRIMINATOR),
      u64Le(accounts.machineId),
    ),
  });
}

export function buildUploadConfigInstruction(
  player: PublicKey,
  accounts: GachaponAccounts,
) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: player, isSigner: true, isWritable: false },
      { pubkey: accounts.machine, isSigner: false, isWritable: true },
    ],
    data: concatBuffers(
      Buffer.from(UPLOAD_CONFIG_DISCRIMINATOR),
      ...REWARDS.map(encodeRewardTemplate),
    ),
  });
}

export function buildPullInstruction(
  player: PublicKey,
  accounts: GachaponAccounts,
  clientSeed: number,
) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: player, isSigner: true, isWritable: true },
      { pubkey: accounts.machine, isSigner: false, isWritable: true },
      { pubkey: accounts.pendingPull, isSigner: false, isWritable: true },
      { pubkey: accounts.asset, isSigner: false, isWritable: true },
      { pubkey: accounts.treasury, isSigner: false, isWritable: true },
      { pubkey: accounts.updateAuthority, isSigner: false, isWritable: false },
      { pubkey: accounts.callbackIdentity, isSigner: false, isWritable: false },
      { pubkey: DEFAULT_VRF_QUEUE, isSigner: false, isWritable: true },
      { pubkey: VRF_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SLOT_HASHES, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: concatBuffers(
      Buffer.from(PULL_DISCRIMINATOR),
      u64Le(accounts.pullId),
      Buffer.from([clientSeed]),
    ),
  });
}

export async function sendWalletTransaction(
  connection: Connection,
  wallet: BrowserWallet,
  payer: PublicKey,
  instruction: TransactionInstruction,
  options: { skipPreflight?: boolean } = {},
) {
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: payer,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction);

  let signature: string;

  if (wallet.signTransaction) {
    const signedTransaction = await wallet.signTransaction(transaction);
    signature = await connection.sendRawTransaction(
      signedTransaction.serialize(),
      {
        skipPreflight: options.skipPreflight ?? false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      },
    );
  } else if (wallet.signAndSendTransaction) {
    const result = await wallet.signAndSendTransaction(transaction);
    signature = result.signature;
  } else {
    throw new Error("Wallet cannot sign transactions");
  }

  await connection.confirmTransaction(
    {
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    "confirmed",
  );

  return signature;
}

export function decodeMachine(data: Buffer): MachineAccount {
  assertDiscriminator(data, MACHINE_DISCRIMINATOR);
  const cursor = { offset: 8 };
  const authority = readPubkey(data, cursor);
  const machineId = readU64(data, cursor);
  readU8(data, cursor);
  readU8(data, cursor);
  readU8(data, cursor);
  const totalWeight = readU32(data, cursor);
  const pullCount = readU64(data, cursor);
  const rewards = Array.from({ length: 4 }, () => ({
    rewardId: readU8(data, cursor),
    weight: readU32(data, cursor),
    mintedCount: readU64(data, cursor),
    name: readString(data, cursor),
    uri: readString(data, cursor),
  }));

  return { authority, machineId, totalWeight, pullCount, rewards };
}

export function decodePendingPull(data: Buffer): PendingPullAccount {
  assertDiscriminator(data, PENDING_PULL_DISCRIMINATOR);
  const cursor = { offset: 8 };

  return {
    machine: readPubkey(data, cursor),
    player: readPubkey(data, cursor),
    asset: readPubkey(data, cursor),
    pullId: readU64(data, cursor),
    rewardId: readU8(data, cursor),
    status: readU8(data, cursor),
  };
}

export function decodeCoreAsset(data: Buffer): CoreAssetAccount {
  const cursor = { offset: 0 };
  if (readU8(data, cursor) !== ASSET_V1_KEY) {
    throw new Error("Account is not a Core asset");
  }

  const owner = readPubkey(data, cursor);
  const updateAuthorityVariant = readU8(data, cursor);
  let updateAuthority: PublicKey | null = null;

  if (updateAuthorityVariant === 1 || updateAuthorityVariant === 2) {
    updateAuthority = readPubkey(data, cursor);
  }

  const name = readString(data, cursor);
  const uri = readString(data, cursor);
  const seqVariant = readU8(data, cursor);
  if (seqVariant === 1) {
    readU64(data, cursor);
  }

  let attributes = new Map<string, string>();
  if (cursor.offset < data.length) {
    const headerKey = readU8(data, cursor);
    if (headerKey === PLUGIN_HEADER_V1_KEY) {
      attributes = readPluginRegistry(data, Number(readU64(data, cursor)));
    }
  }

  return { owner, updateAuthority, name, uri, attributes };
}

export function isSettled(pull: PendingPullAccount) {
  return pull.status === PULL_STATUS_SETTLED;
}

function findPda(seeds: Array<Buffer | Uint8Array>) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

function stringSeed(value: string) {
  return Buffer.from(value);
}

function concatBuffers(...buffers: Buffer[]) {
  return Buffer.concat(buffers);
}

function encodeRewardTemplate(reward: RewardTemplate) {
  return concatBuffers(
    u32Le(reward.weight),
    encodeString(reward.name),
    encodeString(reward.uri),
  );
}

function encodeString(value: string) {
  const bytes = Buffer.from(value, "utf8");
  return concatBuffers(u32Le(bytes.length), bytes);
}

function u32Le(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function u64Le(value: bigint) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value, 0);
  return buffer;
}

function readU8(data: Buffer, cursor: Cursor) {
  const value = data.readUInt8(cursor.offset);
  cursor.offset += 1;
  return value;
}

function readU32(data: Buffer, cursor: Cursor) {
  const value = data.readUInt32LE(cursor.offset);
  cursor.offset += 4;
  return value;
}

function readU64(data: Buffer, cursor: Cursor) {
  const value = data.readBigUInt64LE(cursor.offset);
  cursor.offset += 8;
  return value;
}

function readPubkey(data: Buffer, cursor: Cursor) {
  const value = new PublicKey(data.subarray(cursor.offset, cursor.offset + 32));
  cursor.offset += 32;
  return value;
}

function readString(data: Buffer, cursor: Cursor) {
  const length = readU32(data, cursor);
  const value = data.toString("utf8", cursor.offset, cursor.offset + length);
  cursor.offset += length;
  return value;
}

function readPluginAuthority(data: Buffer, cursor: Cursor) {
  const variant = readU8(data, cursor);
  if (variant === 3) {
    readPubkey(data, cursor);
  }
}

function readPluginRegistry(data: Buffer, offset: number) {
  const cursor = { offset };
  const registryKey = readU8(data, cursor);
  if (registryKey !== PLUGIN_REGISTRY_V1_KEY) {
    return new Map<string, string>();
  }

  const registryCount = readU32(data, cursor);
  for (let index = 0; index < registryCount; index += 1) {
    const pluginType = readU8(data, cursor);
    readPluginAuthority(data, cursor);
    const pluginOffset = Number(readU64(data, cursor));

    if (pluginType === ATTRIBUTES_PLUGIN_TYPE) {
      return readAttributesPlugin(data, pluginOffset);
    }
  }

  return new Map<string, string>();
}

function readAttributesPlugin(data: Buffer, offset: number) {
  const cursor = { offset };
  const pluginVariant = readU8(data, cursor);
  if (pluginVariant !== ATTRIBUTES_PLUGIN_TYPE) {
    return new Map<string, string>();
  }

  const attributes = new Map<string, string>();
  const attributeCount = readU32(data, cursor);
  for (let index = 0; index < attributeCount; index += 1) {
    attributes.set(readString(data, cursor), readString(data, cursor));
  }

  return attributes;
}

function assertDiscriminator(data: Buffer, discriminator: number[]) {
  if (data.length < discriminator.length) {
    throw new Error("Account data is too short");
  }

  for (let index = 0; index < discriminator.length; index += 1) {
    if (data[index] !== discriminator[index]) {
      throw new Error("Unexpected account discriminator");
    }
  }
}
