import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { RELAY_FEE, formatUsdc, parseUsdc } from "./lib/config";
import {
  base,
  commitJarInstruction,
  explorerUrl,
  fetchJar,
  jarTokenBalance,
  readBalances,
  sendOnEr,
  tipInstruction,
  withdrawTipsInstruction,
} from "./lib/chain";
import { SponsoredPayments, type Balances } from "./lib/sponsored";
import { exportWallet, importWallet, openWallet } from "./lib/wallet";

const JAR = import.meta.env.VITE_JAR_ADDRESS as string | undefined;
const TIPS = [100_000n, 500_000n, 1_000_000n];
const payments = new SponsoredPayments(base, readBalances);

interface JarView {
  authority: PublicKey;
  totalTipped: bigint;
  tipCount: number;
  balance: bigint;
}
interface Activity {
  label: string;
  signature: string;
  onEr: boolean;
  ms: number;
}

export default function App() {
  const jar = useMemo(() => (JAR ? new PublicKey(JAR) : null), []);
  const [wallet, setWallet] = useState<Keypair>();
  const [balances, setBalances] = useState<Balances>();
  const [lamports, setLamports] = useState<number>();
  const [jarView, setJarView] = useState<JarView>();
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(
    async (owner: Keypair) => {
      const [nextBalances, nextLamports] = await Promise.all([
        readBalances(owner.publicKey),
        base.getBalance(owner.publicKey),
      ]);
      setBalances(nextBalances);
      setLamports(nextLamports);
      setPending(Boolean(payments.pending(owner.publicKey)));
      if (jar) {
        const [account, balance] = await Promise.all([
          fetchJar(jar),
          jarTokenBalance(jar),
        ]);
        setJarView({
          authority: account.authority,
          totalTipped: BigInt(account.totalTipped.toString()),
          tipCount: account.tipCount.toNumber(),
          balance,
        });
      }
    },
    [jar],
  );

  useEffect(() => {
    openWallet()
      .then(async (owner) => {
        setWallet(owner);
        // Finish (or fail) any payment left over from a previous visit.
        await payments
          .reconcile(owner.publicKey)
          .catch((e) => setError(e.message));
        await refresh(owner);
      })
      .catch((e) => setError(e.message));
  }, [refresh]);

  useEffect(() => {
    if (!wallet) return;
    const id = setInterval(() => refresh(wallet).catch(() => undefined), 5000);
    return () => clearInterval(id);
  }, [wallet, refresh]);

  async function run(
    label: string,
    onEr: boolean,
    action: () => Promise<string>,
  ) {
    if (!wallet) return;
    setBusy(label);
    setError(undefined);
    const started = performance.now();
    try {
      const signature = await action();
      const ms = Math.round(performance.now() - started);
      setActivity((items) =>
        [{ label, signature, onEr, ms }, ...items].slice(0, 12),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
      await refresh(wallet).catch(() => undefined);
    }
  }

  const pay = (kind: "deposit" | "withdraw") =>
    run(
      `${kind === "deposit" ? "Deposit" : "Withdraw"} ${amount} USDC`,
      false,
      () => payments.pay(wallet!, kind, parseUsdc(amount)),
    );
  const tip = (value: bigint) =>
    run(`Tip ${formatUsdc(value)} USDC`, true, async () =>
      sendOnEr(wallet!, await tipInstruction(wallet!.publicKey, jar!, value)),
    );
  const collect = () =>
    run(`Collect ${formatUsdc(jarView!.balance)} USDC`, true, async () =>
      sendOnEr(
        wallet!,
        await withdrawTipsInstruction(
          wallet!.publicKey,
          jar!,
          jarView!.balance,
        ),
      ),
    );
  const commit = () =>
    run("Commit jar to Solana", true, async () =>
      sendOnEr(wallet!, await commitJarInstruction(wallet!.publicKey, jar!)),
    );

  async function checkPending() {
    if (!wallet) return;
    setError(undefined);
    try {
      await payments.reconcile(wallet.publicKey, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await refresh(wallet);
  }

  async function onImport(file: File | undefined) {
    if (!file || !wallet) return;
    if (
      !confirm(
        "Replace this browser's wallet? Export it first if it holds funds.",
      )
    )
      return;
    try {
      const next = await importWallet(file);
      setWallet(next);
      await refresh(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const isAuthority = Boolean(
    wallet && jarView?.authority.equals(wallet.publicKey),
  );
  const disabled = Boolean(busy) || pending;

  return (
    <main>
      <header>
        <h1>Gasless Tip Jar</h1>
        <p>
          Your wallet holds no SOL. Deposits and withdrawals are sponsored by
          the MagicBlock Payments API, and tips run on an Ephemeral Rollup where
          transactions are free.
        </p>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Wallet</h2>
        <p className="mono">
          {wallet?.publicKey.toBase58() ?? "Opening wallet…"}
        </p>
        <dl className="stats">
          <div>
            <dt>SOL</dt>
            <dd>
              {lamports === undefined ? "–" : (lamports / 1e9).toFixed(4)}
            </dd>
          </div>
          <div>
            <dt>USDC on Solana</dt>
            <dd>{balances ? formatUsdc(balances.base) : "–"}</dd>
          </div>
          <div>
            <dt>USDC on the rollup</dt>
            <dd>{balances ? formatUsdc(balances.er) : "–"}</dd>
          </div>
        </dl>
        <div className="row">
          <a
            className="button secondary"
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
          >
            Get devnet USDC
          </a>
          <button
            className="secondary"
            disabled={!wallet}
            onClick={() => wallet && exportWallet(wallet)}
          >
            Export key
          </button>
          <button
            className="secondary"
            disabled={!wallet}
            onClick={() => fileInput.current?.click()}
          >
            Import key
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // so picking the same file again still fires
              onImport(file);
            }}
          />
        </div>
      </section>

      <section className="card">
        <h2>Move USDC</h2>
        <p className="hint">
          Each move costs a {formatUsdc(RELAY_FEE)} USDC relay fee, taken from
          your Solana balance. No SOL needed.
        </p>
        <div className="row">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            aria-label="Amount in USDC"
          />
          <button disabled={disabled || !wallet} onClick={() => pay("deposit")}>
            Deposit to rollup
          </button>
          <button
            className="secondary"
            disabled={disabled || !wallet}
            onClick={() => pay("withdraw")}
          >
            Withdraw to Solana
          </button>
        </div>
        {pending && (
          <div className="notice">
            A payment is settling.{" "}
            <button className="link" onClick={checkPending}>
              Check again
            </button>
            {" · "}
            <button
              className="link"
              onClick={() => {
                if (
                  wallet &&
                  confirm(
                    "Forget this payment? Only do this if you are sure it failed.",
                  )
                ) {
                  payments.forget(wallet.publicKey);
                  setPending(false);
                }
              }}
            >
              Forget it
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Tip jar</h2>
        {!jar ? (
          <p className="hint">
            Set <code>VITE_JAR_ADDRESS</code> in <code>app/.env</code>. Create a
            jar with <code>yarn create-jar</code> (see the README).
          </p>
        ) : (
          <>
            <p className="mono">{jar.toBase58()}</p>
            <dl className="stats">
              <div>
                <dt>Total tipped</dt>
                <dd>{jarView ? formatUsdc(jarView.totalTipped) : "–"}</dd>
              </div>
              <div>
                <dt>Tips</dt>
                <dd>{jarView?.tipCount ?? "–"}</dd>
              </div>
              <div>
                <dt>In the jar</dt>
                <dd>{jarView ? formatUsdc(jarView.balance) : "–"}</dd>
              </div>
            </dl>
            <div className="row">
              {TIPS.map((value) => (
                <button
                  key={value.toString()}
                  disabled={disabled || !balances || balances.er < value}
                  onClick={() => tip(value)}
                >
                  Tip {formatUsdc(value)}
                </button>
              ))}
            </div>
            {isAuthority && (
              <div className="row">
                <button
                  className="secondary"
                  disabled={disabled || !jarView?.balance}
                  onClick={collect}
                >
                  Collect tips
                </button>
                <button
                  className="secondary"
                  disabled={disabled}
                  onClick={commit}
                >
                  Commit to Solana
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Activity</h2>
        {busy && <p className="hint">{busy}…</p>}
        {activity.length === 0 && !busy && <p className="hint">Nothing yet.</p>}
        <ul className="activity">
          {activity.map((item) => (
            <li key={item.signature}>
              <span>{item.label}</span>
              <span className="tag">{item.onEr ? "rollup" : "Solana"}</span>
              <span>{item.ms} ms</span>
              <a
                href={explorerUrl(item.signature, item.onEr)}
                target="_blank"
                rel="noreferrer"
              >
                {item.signature.slice(0, 8)}…
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
