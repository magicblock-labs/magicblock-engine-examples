/**
 * Client-side test using @solana/kit.
 *
 * Integration: `RUN_INTEGRATION=1` + **`RUN_INIT_INTEGRATION=1`** to run this file’s on-chain init
 * (so default VRF runs don’t require re-init). **devnet** + `getTestProgramId()`.
 * Shared helpers: `test/utils.ts`.
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
  encodeRequestRandomnessInstruction,
  getTestProgramId,
  getPlayerPda,
  IX_INITIALIZE_PLAYER,
  loadKeyPairSignerFromFile,
  logTransactionExplorer,
  readU64LE,
  type LoadedKeyPairSigner,
} from "./utils.js";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
/** Set with `RUN_INTEGRATION=1` when you need to create the player PDA on-chain (first-time / clean wallet). */
const RUN_INIT_INTEGRATION = process.env.RUN_INIT_INTEGRATION === "1";

describe.runIf(RUN_INTEGRATION && RUN_INIT_INTEGRATION)("initialize_player (chain integration)", () => {
  const { rpc, sendAndConfirmTransaction, rpcUrl } = createDevnetKitClients();
  let payer: LoadedKeyPairSigner;

  beforeAll(async () => {
    payer = await loadKeyPairSignerFromFile();
  });

  it("creates the player PDA and writes PlayerState (discriminator, random, bump)", async () => {
    const programAddress = address(getTestProgramId());
    const systemProgram = address("11111111111111111111111111111111");
    const [playerPda, bump] = await getPlayerPda(programAddress, payer.address);

    const ix = {
      programAddress,
      data: IX_INITIALIZE_PLAYER,
      accounts: [
        { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
        { address: playerPda, role: AccountRole.WRITABLE },
        { address: systemProgram, role: AccountRole.READONLY },
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

    await sendAndConfirmTransaction(
      asSendableBlockhashTransaction(transaction),
      { commitment: "confirmed" },
    );
    const signature = String(getSignatureFromTransaction(transaction));

    const account = await rpc.getAccountInfo(playerPda, { encoding: "base64" }).send();
    expect(account.value).not.toBeNull();
    const raw = dataBase64ToBytes(account.value!.data!);
    expect(raw[0]).toBe(1);
    expect(readU64LE(raw.subarray(1, 9))).toBe(0n);
    expect(raw[9]).toBe(bump);

    logTransactionExplorer("initialize_player", rpcUrl, signature);
  });
});

describe("client wiring (no RPC)", () => {
  it("encodes InitializePlayer the same as on-chain Borsh", () => {
    expect([...IX_INITIALIZE_PLAYER]).toEqual([0]);
  });

  it("encodes RequestRandomness the same as on-chain Borsh", () => {
    expect([...encodeRequestRandomnessInstruction(7)]).toEqual([1, 7]);
  });
});
