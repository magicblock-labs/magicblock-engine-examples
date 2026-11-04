import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, type Connection, type PublicKey } from "@solana/web3.js";
import { SponsoredPayments, type Balances } from "../src/lib/sponsored";
import { apiBuild } from "./fixtures";

// In-memory stand-ins for localStorage, the base RPC and the Payments API.
function memoryStore() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

interface FakeBase {
  sent: number;
  status: { err: unknown; confirmationStatus?: string } | null;
  height: number;
  sendFails: boolean;
}

function fakeBase(state: FakeBase) {
  return {
    async sendRawTransaction() {
      state.sent++;
      if (state.sendFails) throw new Error("network down");
      return "sig";
    },
    async getSignatureStatuses() {
      return { value: [state.status] };
    },
    async getBlockHeight() {
      return state.height;
    },
  } as unknown as Connection;
}

const realFetch = globalThis.fetch;
let owner: Keypair;
let state: FakeBase;
let balances: Balances;
let store: ReturnType<typeof memoryStore>;
let payments: SponsoredPayments;

beforeEach(() => {
  owner = Keypair.generate();
  state = { sent: 0, status: null, height: 10, sendFails: false };
  balances = { base: 5_000_000n, er: 0n };
  store = memoryStore();
  payments = new SponsoredPayments(
    fakeBase(state),
    async (_: PublicKey) => ({ ...balances }),
    store,
  );
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.gasless, true);
    const kind = url.endsWith("/withdraw") ? "withdraw" : "deposit";
    const build = await apiBuild(owner, kind, BigInt(body.amount));
    return new Response(JSON.stringify(build), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("saves the receipt before sending and settles once the rollup balance arrives", async () => {
  state.status = { err: null, confirmationStatus: "confirmed" };
  const paying = payments.pay(owner, "deposit", 1_000_000n);
  // The deposit reaches the rollup a moment after it lands on Solana.
  setTimeout(() => (balances = { base: 3_800_000n, er: 1_000_000n }), 50);
  await paying;
  assert.equal(payments.pending(owner.publicKey), null);
});

test("a failed send keeps the receipt and blocks a second payment", async () => {
  state.sendFails = true;
  const first = payments.pay(owner, "deposit", 1_000_000n);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(payments.pending(owner.publicKey), "receipt saved before sending");
  await assert.rejects(
    payments.pay(owner, "deposit", 1_000_000n),
    /still settling/,
  );
  // Let the first payment fail cleanly so the test ends.
  state.status = { err: { InstructionError: [0, "Custom"] } };
  await assert.rejects(first, /failed on Solana/);
});

test("clears the receipt when the payment fails on Solana", async () => {
  state.status = { err: { InstructionError: [1, { Custom: 1 }] } };
  await assert.rejects(
    payments.pay(owner, "deposit", 1_000_000n),
    /failed on Solana/,
  );
  assert.equal(payments.pending(owner.publicKey), null);
});

test("clears the receipt when the blockhash expires without landing", async () => {
  state.height = 2_000; // past the build's lastValidBlockHeight of 1,000
  await assert.rejects(payments.pay(owner, "deposit", 1_000_000n), /expired/);
  assert.equal(payments.pending(owner.publicKey), null);
});

test("refuses a deposit that would leave nothing to pay for a withdrawal", async () => {
  balances = { base: 1_300_000n, er: 0n };
  await assert.rejects(
    payments.pay(owner, "deposit", 1_000_000n),
    /0.20 USDC left/,
  );
  assert.equal(state.sent, 0);
});
