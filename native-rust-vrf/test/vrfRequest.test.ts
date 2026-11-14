/**
 * Covers the two **user-relevant** paths:
 * 1. `RequestRandomness` — you send this (your program CPIs to the VRF).
 * 2. `CallbackConsumeRandomness` — only the **VRF program** invokes this; we **poll** `PlayerState`
 *    to observe the result (same pattern as MagicBlock Anchor tests).
 *
 * Default: assumes `initialize_player` already ran. Set `AUTO_INIT_PLAYER=1` to create the PDA first.
 * Optional: `RUN_INIT_INTEGRATION=1` enables the separate `initializePlayer` integration test.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  asSendableBlockhashTransaction,
  createDevnetKitClients,
  dataBase64ToBytes,
  assertPlayerInitializedForVrf,
  encodeRequestRandomnessInstruction,
  ensurePlayerInitialized,
  getProgramIdentityPda,
  getTestProgramId,
  getPlayerPda,
  loadKeyPairSignerFromFile,
  logTransactionExplorer,
  pollUntilPlayerRandomValueChanges,
  readPlayerRandomU64Le,
  VRF_CALLBACK_DISCRIMINATOR,
  VRF_CALLBACK_IX_DATA_LEN,
  SLOT_HASHES_SYSVAR,
  SYSTEM_PROGRAM,
  VRF_DEFAULT_QUEUE,
  VRF_PROGRAM_ID,
  type LoadedKeyPairSigner,
} from "./utils.js";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";

async function logSendFailure(label: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`${label} error:`, msg);
  if (err && typeof err === "object" && "logs" in err && Array.isArray((err as { logs: unknown }).logs)) {
    console.error(`${label} logs:\n` + (err as { logs: string[] }).logs.join("\n"));
  }
}

describe.runIf(RUN_INTEGRATION)("vrf: RequestRandomness + callback (integration)", () => {
  const clients = createDevnetKitClients();
  const { rpc, sendAndConfirmTransaction, rpcUrl } = clients;
  let payer: LoadedKeyPairSigner;
  const programId = getTestProgramId();
  const programAddress = address(programId);
  const clientSeed = 7;

  beforeAll(async () => {
    payer = await loadKeyPairSignerFromFile();
    if (process.env.AUTO_INIT_PLAYER === "1") {
      await ensurePlayerInitialized(clients, payer, programId);
    } else {
      await assertPlayerInitializedForVrf(clients, payer, programId);
    }
  });

  it("RequestRandomness → CPI to VRF; then poll for CallbackConsumeRandomness effect on PlayerState", async () => {
    const [playerPda] = await getPlayerPda(programAddress, payer.address);
    const [programIdentityPda] = await getProgramIdentityPda(programAddress);

    const snap = await assertPlayerInitializedForVrf(clients, payer, programId);
    const beforeRandom = snap.randomValue;

    console.log("\n─── 1) RequestRandomness (wallet signs; program invoke_signed → VRF) ───");
    console.log("client_seed:", clientSeed, "| PlayerState.random_value before request:", beforeRandom.toString());

    const data = encodeRequestRandomnessInstruction(clientSeed);
    // On-chain handler uses accounts[0..5]. Match Anchor: also pass VRF program (readonly) so the
    // cluster can load the CPI target — avoids simulation error: missing account on the instruction.
    const ix = {
      programAddress,
      data,
      accounts: [
        { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
        { address: programIdentityPda, role: AccountRole.READONLY },
        { address: VRF_DEFAULT_QUEUE, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        { address: SLOT_HASHES_SYSVAR, role: AccountRole.READONLY },
        { address: playerPda, role: AccountRole.WRITABLE },
        { address: VRF_PROGRAM_ID, role: AccountRole.READONLY },
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
      abortSignal: AbortSignal.timeout(60_000),
    });

    let requestTx: string;
    try {
      await sendAndConfirmTransaction(asSendableBlockhashTransaction(transaction), {
        commitment: "confirmed",
      });
      requestTx = String(getSignatureFromTransaction(transaction));
    } catch (e) {
      await logSendFailure("requestRandomness", e);
      throw e;
    }

    logTransactionExplorer("requestRandomness", rpcUrl, requestTx);

    console.log("\n─── 2) CallbackConsumeRandomness (only VRF invokes; polling account data) ───");

    const afterRandom = await pollUntilPlayerRandomValueChanges(
      async () => {
        const a = await rpc.getAccountInfo(playerPda, { encoding: "base64" }).send();
        if (!a.value) return null;
        return dataBase64ToBytes(a.value.data!);
      },
      beforeRandom,
      { maxWaitMs: 60_000, intervalMs: 500 },
    );

    expect(afterRandom).not.toBe(beforeRandom);
    console.log("PlayerState.random_value (u64 LE) after VRF callback:", afterRandom.toString());
    console.log("hex:", "0x" + afterRandom.toString(16));
  });
});

describe("vrf client wiring (no RPC)", () => {
  it("callback ix data is 8-byte discriminator + 32 random (matches vrf_lite)", () => {
    expect(VRF_CALLBACK_DISCRIMINATOR.length + 32).toBe(VRF_CALLBACK_IX_DATA_LEN);
    expect(VRF_CALLBACK_IX_DATA_LEN).toBe(40);
  });
});
