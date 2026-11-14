import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Address } from "@solana/addresses";
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  devnet,
  getAddressEncoder,
  getProgramDerivedAddress,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import type { TransactionWithLastValidBlockHeight } from "@solana/transaction-confirmation";
import type { SendableTransaction, Transaction } from "@solana/transactions";

/** Build a Solana Explorer link. `rpcUrl` picks `?cluster=`. */
export function explorerTxUrl(rpcUrl: string, signature: string): string {
  const url = rpcUrl.toLowerCase();
  let cluster = "devnet";
  if (url.includes("mainnet")) cluster = "mainnet-beta";
  else if (url.includes("testnet")) cluster = "testnet";
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

/** Matches on-chain Borsh: `VrfInstruction::InitializePlayer` (variant 0, u8). */
export const IX_INITIALIZE_PLAYER = new Uint8Array([0]);

/**
 * Borsh: `VrfInstruction::RequestRandomness { client_seed }` (variant 1, u8 + u8). Must match
 * `processor::borsh_tests::request_randomness_bytes_match_ts_fixture` in the program crate.
 */
export function encodeRequestRandomnessInstruction(clientSeed: number): Uint8Array {
  return new Uint8Array([1, clientSeed & 0xff]);
}

/** `ephemeral_vrf_sdk::consts::DEFAULT_QUEUE` / MagicBlock VRF (same as the Anchor `oracleQueue`). */
export const VRF_DEFAULT_QUEUE = address("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
/** `ephemeral_vrf_sdk::consts::VRF_PROGRAM_ID` — include as readonly; Anchor VRF clients pass this so the program is loadable for CPI. */
export const VRF_PROGRAM_ID = address("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
/** `sysvar::slot_hashes` */
export const SLOT_HASHES_SYSVAR = address("SysvarS1otHashes111111111111111111111111111");

/** Matches `vrf_lite::CALLBACK_CONSUME_RANDOMNESS` (8 B) + 32 B randomness — only the VRF invokes this. */
export const VRF_CALLBACK_DISCRIMINATOR = new Uint8Array([
  0xfd, 0xfe, 0x8f, 0x24, 0xd9, 0x2f, 0x7b, 0xbc,
]);
export const VRF_CALLBACK_IX_DATA_LEN = VRF_CALLBACK_DISCRIMINATOR.length + 32;

export function getTestProgramId(): string {
  return process.env.PROGRAM_ID ?? "5hExoUW5SvPxTHTcz3ok117BoLa1TzzG6KZZfWD23DfD";
}

export function getDefaultPayerKeypairPath(): string {
  return process.env.SOLANA_KEYPAIR ?? join(homedir(), ".config", "solana", "id.json");
}

export type LoadedKeyPairSigner = Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>;

export async function loadKeyPairSignerFromFile(
  path: string = getDefaultPayerKeypairPath(),
): Promise<LoadedKeyPairSigner> {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  if (raw.length !== 64) {
    throw new Error(`Expected 64-byte Solana keypair array in ${path}, got length ${raw.length}`);
  }
  return createKeyPairSignerFromBytes(Uint8Array.from(raw));
}

/** `rpc` + `sendAndConfirm` wired for devnet (env overrides: `SOLANA_RPC_URL`, `SOLANA_WS_URL`). */
export function createDevnetKitClients() {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const wsUrl = process.env.SOLANA_WS_URL ?? "wss://api.devnet.solana.com";
  const rpc = createSolanaRpc(devnet(rpcUrl));
  const rpcSubscriptions = createSolanaRpcSubscriptions(devnet(wsUrl));
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  return { rpc, rpcUrl, sendAndConfirmTransaction, wsUrl };
}

/** Kit widens `TransactionWithLifetime`; this matches what `sendAndConfirmTransaction` expects for blockhash txs. */
export function asSendableBlockhashTransaction(
  transaction: object,
): SendableTransaction & Transaction & TransactionWithLastValidBlockHeight {
  return transaction as SendableTransaction & Transaction & TransactionWithLastValidBlockHeight;
}

export function readU64LE(buf: Uint8Array): bigint {
  const v = new DataView(buf.buffer, buf.byteOffset, 8);
  return v.getBigUint64(0, true);
}

export function dataBase64ToBytes(b64: readonly [string, string]): Uint8Array {
  return new Uint8Array(Buffer.from(b64[0] as string, "base64"));
}

export function logTransactionExplorer(
  label: string,
  rpcUrl: string,
  signature: string,
): void {
  console.log(`${label}: ${explorerTxUrl(rpcUrl, signature)}`);
}

/** PDA: seeds `["player", authority]` (matches `state::find_player_pda`). */
export async function getPlayerPda(program: Address, authority: Address) {
  const addressEncoder = getAddressEncoder();
  return getProgramDerivedAddress({
    programAddress: program,
    seeds: [new TextEncoder().encode("player"), addressEncoder.encode(authority)],
  });
}

/** PDA: `["identity"]` under the program (VRF `program_identity` account). */
export async function getProgramIdentityPda(program: Address) {
  return getProgramDerivedAddress({
    programAddress: program,
    seeds: [new TextEncoder().encode("identity")],
  });
}

/**
 * `PlayerState` on-chain: disc (u8) + `random_value` (u64 le) + bump (u8). Returns `0n` for empty/bad.
 */
export function readPlayerRandomU64Le(accountData: Uint8Array): bigint {
  if (accountData.length < 10) return 0n;
  if (accountData[0] !== 1) return 0n;
  return readU64LE(accountData.subarray(1, 9));
}

export type DevnetKitClients = ReturnType<typeof createDevnetKitClients>;

/**
 * Fails fast if the player PDA is missing or not `PlayerState`-initialized. Use when you already ran
 * `initialize_player` on-chain and only want VRF tests.
 */
export async function assertPlayerInitializedForVrf(
  clients: DevnetKitClients,
  payer: LoadedKeyPairSigner,
  programIdStr: string = getTestProgramId(),
): Promise<{ playerPda: Address; bump: number; randomValue: bigint }> {
  const programAddress = address(programIdStr);
  const [playerPda] = await getPlayerPda(programAddress, payer.address);
  const acc = await clients.rpc.getAccountInfo(playerPda, { encoding: "base64" }).send();
  if (!acc.value) {
    throw new Error(
      "Player PDA missing. Run initialize_player once, or rerun with AUTO_INIT_PLAYER=1.",
    );
  }
  const raw = dataBase64ToBytes(acc.value.data!);
  if (raw[0] !== 1 || raw.length < 10) {
    throw new Error(
      "Player account is not initialized (expected disc=1). Run initialize_player or AUTO_INIT_PLAYER=1.",
    );
  }
  return {
    playerPda,
    bump: raw[9]!,
    randomValue: readPlayerRandomU64Le(raw),
  };
}

/**
 * If the player PDA is missing or not initialized, send `InitializePlayer`. Idempotent for tests.
 */
export async function ensurePlayerInitialized(
  clients: DevnetKitClients,
  payer: LoadedKeyPairSigner,
  programIdStr: string = getTestProgramId(),
) {
  const { rpc, sendAndConfirmTransaction } = clients;
  const programAddress = address(programIdStr);
  const [playerPda] = await getPlayerPda(programAddress, payer.address);

  const acc = await rpc.getAccountInfo(playerPda, { encoding: "base64" }).send();
  if (acc.value) {
    const raw = dataBase64ToBytes(acc.value.data!);
    if (raw[0] === 1 && raw.length >= 10) {
      return { playerPda, bump: raw[9]! };
    }
  }

  const ix = {
    programAddress,
    data: IX_INITIALIZE_PLAYER,
    accounts: [
      { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
      { address: playerPda, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
  };
  const { value: latest } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
    (m) => appendTransactionMessageInstruction(ix, m),
  );
  const transaction = await signTransactionMessageWithSigners(message, {
    abortSignal: AbortSignal.timeout(30_000),
  });
  await sendAndConfirmTransaction(asSendableBlockhashTransaction(transaction), {
    commitment: "confirmed",
  });

  const a2 = await rpc.getAccountInfo(playerPda, { encoding: "base64" }).send();
  if (!a2.value) throw new Error("player PDA still missing after initialize");
  const raw2 = dataBase64ToBytes(a2.value.data!);
  return { playerPda, bump: raw2[9]! };
}

/**
 * Poll until VRF **callback** updates `PlayerState.random_value` (async vs `request` tx). Same idea as
 * the Anchor `pollUntilSeedStateChanges` helper.
 */
export async function pollUntilPlayerRandomValueChanges(
  fetchAccountData: () => Promise<Uint8Array | null>,
  beforeRandom: bigint,
  opts: { maxWaitMs: number; intervalMs: number },
): Promise<bigint> {
  const start = Date.now();
  while (Date.now() - start < opts.maxWaitMs) {
    const raw = await fetchAccountData();
    if (raw) {
      const n = readPlayerRandomU64Le(raw);
      if (n !== beforeRandom) return n;
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
  throw new Error(
    `Timeout after ${opts.maxWaitMs}ms waiting for VRF callback (random still ${beforeRandom}).`,
  );
}
