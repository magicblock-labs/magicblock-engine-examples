import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { RELAY_FEE, invariant } from "./config";
import { buildPayment, validatePayment, type PaymentKind } from "./payments";

export interface Balances {
  base: bigint; // USDC in the wallet's token account on Solana
  er: bigint; // USDC available on the Ephemeral Rollup
}

// A signed payment is saved before it is sent and kept until its outcome is
// known. While it is pending the app refuses to build another one: if a send
// times out the payment may still land, and a second one would charge twice.
interface Receipt {
  kind: PaymentKind;
  amount: string;
  signature: string;
  transactionBase64: string;
  lastValidBlockHeight: number;
  // The payment is complete once this balance reaches `atLeast`. Deposits land
  // on the base layer first and reach the ER a moment later; withdrawals the
  // other way round. This check is enough because the app blocks other moves
  // while a payment is pending. For a history-based proof that also tolerates
  // concurrent transfers, see bomberman-er's shared/payment-recovery.ts.
  balance: keyof Balances;
  atLeast: string;
  landed?: boolean;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SponsoredPayments {
  constructor(
    private base: Connection,
    private readBalances: (owner: PublicKey) => Promise<Balances>,
    private storage: Store = localStorage,
  ) {}

  private key = (owner: PublicKey) => `gasless-starter.payment.${owner}`;

  pending(owner: PublicKey): Receipt | null {
    const saved = this.storage.getItem(this.key(owner));
    return saved ? (JSON.parse(saved) as Receipt) : null;
  }

  /** Drop a receipt the user has given up on. Never call this automatically. */
  forget(owner: PublicKey) {
    this.storage.removeItem(this.key(owner));
  }

  /** Build, check, sign and send a gasless payment, then wait for it to settle. */
  async pay(
    owner: Keypair,
    kind: PaymentKind,
    amount: bigint,
  ): Promise<string> {
    invariant(
      !this.pending(owner.publicKey),
      "A payment is still settling. Wait for it before starting another.",
    );
    const before = await this.readBalances(owner.publicKey);
    if (kind === "deposit") {
      // Keep one relay fee on Solana so the user can always withdraw later.
      invariant(
        before.base >= amount + 2n * RELAY_FEE,
        "Deposits need the amount, a 0.20 USDC fee, and 0.20 USDC left for a later withdrawal.",
      );
    } else {
      invariant(before.er >= amount, "Not enough USDC on the rollup.");
      invariant(
        before.base >= RELAY_FEE,
        "Withdrawals need 0.20 USDC in your Solana wallet to pay the fee.",
      );
    }

    const build = await buildPayment(owner.publicKey, kind, amount);
    const tx = await validatePayment(build, owner.publicKey, kind, amount);
    const message = tx.serializeMessage();
    tx.partialSign(owner); // adds the owner signature, keeps the sponsor's
    invariant(
      tx.serializeMessage().equals(message) && tx.verifySignatures(),
      "Signing changed the payment.",
    );

    const raw = tx.serialize();
    const receipt: Receipt = {
      kind,
      amount: String(amount),
      signature: bs58.encode(tx.signature!),
      transactionBase64: raw.toString("base64"),
      lastValidBlockHeight: build.lastValidBlockHeight,
      ...(kind === "deposit"
        ? { balance: "er", atLeast: String(before.er + amount) }
        : {
            balance: "base",
            atLeast: String(before.base - RELAY_FEE + amount),
          }),
    };
    this.storage.setItem(this.key(owner.publicKey), JSON.stringify(receipt));

    try {
      await this.base.sendRawTransaction(raw, { maxRetries: 0 });
    } catch {
      // A failed send does not mean the payment failed. Reconcile decides.
    }
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await this.reconcile(owner.publicKey, attempt % 5 === 4)) {
        return receipt.signature;
      }
      await sleep(1000);
    }
    throw new Error(
      "The payment is still settling. Its receipt is saved; refresh in a minute.",
    );
  }

  /**
   * Check the saved payment. Returns true when there is nothing pending. Throws
   * (and clears the receipt) when the payment definitely failed or expired.
   */
  async reconcile(owner: PublicKey, resend = false): Promise<boolean> {
    const receipt = this.pending(owner);
    if (!receipt) return true;

    const status = (
      await this.base.getSignatureStatuses([receipt.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (status?.err) {
      this.forget(owner);
      throw new Error("The payment failed on Solana. Nothing was charged.");
    }
    if (
      status?.confirmationStatus &&
      status.confirmationStatus !== "processed"
    ) {
      receipt.landed = true;
      this.storage.setItem(this.key(owner), JSON.stringify(receipt));
    }

    if (receipt.landed) {
      const balances = await this.readBalances(owner);
      if (balances[receipt.balance] >= BigInt(receipt.atLeast)) {
        this.forget(owner);
        return true;
      }
      return false;
    }

    // Not seen yet. Once its blockhash expires it can never land.
    const height = await this.base.getBlockHeight("finalized");
    if (height > receipt.lastValidBlockHeight) {
      this.forget(owner);
      throw new Error(
        "The payment expired without landing. You can try again.",
      );
    }
    if (resend) {
      const raw = Buffer.from(receipt.transactionBase64, "base64");
      await this.base
        .sendRawTransaction(raw, { maxRetries: 0 })
        .catch(() => undefined);
    }
    return false;
  }
}
