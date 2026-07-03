import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock3,
  Database,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Shield,
  Wallet,
} from "lucide-react";
import {
  approveMarket,
  BASE_ENDPOINT,
  bootstrapMarket,
  Direction,
  ER_ENDPOINT,
  loadOrCreateMarket,
  LogEntry,
  MarketSnapshot,
  placeBet,
  refreshSnapshot,
  resetStoredMarket,
  settleBet,
  shortKey,
  StoredMarket,
} from "./lib/binaryPrediction";

const initialLogs: LogEntry[] = [
  {
    id: 1,
    tone: "info",
    message: "Client ready",
  },
];

function numberOrDefault(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function expiryLabel(snapshot: MarketSnapshot | null) {
  if (!snapshot?.isOpen || snapshot.expiry === "-") return "No open ticket";
  const expiry = Number(snapshot.expiry);
  const remaining = Math.max(0, expiry - Math.floor(Date.now() / 1000));
  return remaining > 0 ? `${remaining}s to settle` : "Ready to settle";
}

function App() {
  const [market, setMarket] = useState<StoredMarket>(() =>
    loadOrCreateMarket(),
  );
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [setupPrice, setSetupPrice] = useState("100");
  const [settlementPrice, setSettlementPrice] = useState("110");
  const [stake, setStake] = useState("100");
  const [duration, setDuration] = useState("8");
  const [direction, setDirection] = useState<Direction>("up");
  const [tick, setTick] = useState(0);

  const isBusy = Boolean(busyLabel);
  const isBootstrapped = Boolean(
    market.mint && market.userAta && market.poolAta,
  );

  const pushLog = useCallback((entry: Omit<LogEntry, "id">) => {
    setLogs((current) => [
      { ...entry, id: Date.now() + Math.random() },
      ...current,
    ]);
  }, []);

  const refresh = useCallback(async () => {
    const nextSnapshot = await refreshSnapshot(market);
    setSnapshot(nextSnapshot);
  }, [market]);

  useEffect(() => {
    refresh().catch(() => {
      setSnapshot(null);
    });
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const marketStatus = useMemo(() => {
    if (!isBootstrapped) return "Uninitialized";
    if (snapshot?.isOpen) return "Ticket open";
    return "Ready";
  }, [isBootstrapped, snapshot?.isOpen]);

  const run = useCallback(
    async (label: string, task: () => Promise<void>) => {
      setBusyLabel(label);
      try {
        await task();
        await refresh();
      } catch (error) {
        pushLog({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusyLabel(null);
      }
    },
    [pushLog, refresh],
  );

  const handleBootstrap = () =>
    run("Bootstrapping market", async () => {
      const nextMarket = await bootstrapMarket(market, {
        seedAmount: 10_000,
        userAmount: 1_000,
        durationSeconds: numberOrDefault(duration, 8),
        minStake: 10,
        payoutBps: 19_000,
        price: numberOrDefault(setupPrice, 100),
        onLog: pushLog,
      });
      setMarket(nextMarket);
    });

  const handleApprove = () =>
    run("Approving token allowances", async () => {
      await approveMarket(market, numberOrDefault(stake, 100));
      pushLog({ tone: "success", message: "Token allowances refreshed" });
    });

  const handlePlaceBet = () =>
    run("Placing prediction", async () => {
      await approveMarket(market, numberOrDefault(stake, 100));
      const signature = await placeBet(
        market,
        direction,
        numberOrDefault(stake, 100),
      );
      pushLog({
        tone: "success",
        message: `${direction.toUpperCase()} ticket opened`,
        signature,
      });
    });

  const handleSettle = () =>
    run("Settling ticket", async () => {
      const signature = await settleBet(
        market,
        numberOrDefault(settlementPrice, 110),
      );
      pushLog({ tone: "success", message: "Ticket settled", signature });
    });

  const handleReset = () => {
    resetStoredMarket();
    const nextMarket = loadOrCreateMarket();
    setMarket(nextMarket);
    setSnapshot(null);
    setLogs(initialLogs);
  };

  return (
    <main className="terminal">
      <section className="topbar">
        <div>
          <p className="eyebrow">MagicBlock ER</p>
          <h1>Binary Prediction Desk</h1>
        </div>
        <div className="network-strip" aria-label="Network endpoints">
          <span>Base {BASE_ENDPOINT.replace("http://", "")}</span>
          <span>ER {ER_ENDPOINT.replace("http://", "")}</span>
        </div>
      </section>

      <section className="status-band">
        <article>
          <Shield size={18} />
          <span>Market</span>
          <strong>{marketStatus}</strong>
        </article>
        <article>
          <Wallet size={18} />
          <span>User</span>
          <strong>{shortKey(snapshot?.user)}</strong>
        </article>
        <article>
          <Database size={18} />
          <span>Mint</span>
          <strong>{shortKey(snapshot?.mint)}</strong>
        </article>
        <article>
          <Clock3 size={18} />
          <span>Expiry</span>
          <strong>{expiryLabel(snapshot)}</strong>
        </article>
      </section>

      <section className="price-lane" aria-label="Prediction lifecycle">
        <div>
          <span>Open</span>
          <strong>{snapshot?.openPrice ?? "-"}</strong>
        </div>
        <div className={`direction-chip ${direction}`}>
          {direction === "up" ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
          {direction.toUpperCase()}
        </div>
        <div>
          <span>Settle</span>
          <strong>{settlementPrice || "-"}</strong>
        </div>
        <div>
          <span>Stake</span>
          <strong>{snapshot?.isOpen ? snapshot.stake : stake || "-"}</strong>
        </div>
      </section>

      <section className="workspace">
        <div className="panel setup-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Bootstrap</p>
              <h2>Market setup</h2>
            </div>
            <button className="icon-button" onClick={refresh} disabled={isBusy}>
              <RefreshCw size={16} />
            </button>
          </div>
          <label>
            Opening oracle price
            <input
              value={setupPrice}
              onChange={(event) => setSetupPrice(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label>
            Duration seconds
            <input
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <button
            className="primary-button"
            onClick={handleBootstrap}
            disabled={isBusy || isBootstrapped}
          >
            {isBusy && busyLabel === "Bootstrapping market" ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Play size={16} />
            )}
            Initialize market
          </button>
          <button
            className="ghost-button"
            onClick={handleReset}
            disabled={isBusy}
          >
            <RotateCcw size={16} />
            New local wallet set
          </button>
        </div>

        <div className="panel ticket-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Ticket</p>
              <h2>Prediction order</h2>
            </div>
            <div className="ticket-flags">
              <span className="quiet-pill">Direct signer</span>
              {snapshot?.isOpen ? (
                <span className="live-pill">Open</span>
              ) : (
                <span className="quiet-pill">Idle</span>
              )}
            </div>
          </div>
          <div className="segmented">
            <button
              className={direction === "up" ? "selected up" : ""}
              onClick={() => setDirection("up")}
              disabled={isBusy}
            >
              <ArrowUp size={16} />
              Up
            </button>
            <button
              className={direction === "down" ? "selected down" : ""}
              onClick={() => setDirection("down")}
              disabled={isBusy}
            >
              <ArrowDown size={16} />
              Down
            </button>
          </div>
          <label>
            Stake
            <input
              value={stake}
              onChange={(event) => setStake(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <button
            className="primary-button trade"
            onClick={handlePlaceBet}
            disabled={isBusy || !isBootstrapped || Boolean(snapshot?.isOpen)}
          >
            {isBusy && busyLabel === "Placing prediction" ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Activity size={16} />
            )}
            Place bet
          </button>
          <button
            className="ghost-button"
            onClick={handleApprove}
            disabled={isBusy || !isBootstrapped}
          >
            <CheckCircle2 size={16} />
            Approve allowance
          </button>
        </div>

        <div className="panel settle-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Resolve</p>
              <h2>Settlement</h2>
            </div>
            <span className="quiet-pill" key={tick}>
              {expiryLabel(snapshot)}
            </span>
          </div>
          <label>
            Settlement oracle price
            <input
              value={settlementPrice}
              onChange={(event) => setSettlementPrice(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <button
            className="primary-button settle"
            onClick={handleSettle}
            disabled={isBusy || !snapshot?.isOpen}
          >
            {isBusy && busyLabel === "Settling ticket" ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
            Settle
          </button>
          <dl className="balances">
            <div>
              <dt>User tokens</dt>
              <dd>{snapshot?.userTokens ?? "-"}</dd>
            </div>
            <div>
              <dt>Pool tokens</dt>
              <dd>{snapshot?.poolTokens ?? "-"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="lower-grid">
        <div className="panel account-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Accounts</p>
              <h2>Runtime map</h2>
            </div>
          </div>
          <dl className="account-list">
            <div>
              <dt>Pool</dt>
              <dd>{shortKey(snapshot?.pool)}</dd>
            </div>
            <div>
              <dt>Bet</dt>
              <dd>{shortKey(snapshot?.bet)}</dd>
            </div>
            <div>
              <dt>Oracle</dt>
              <dd>{shortKey(snapshot?.priceFeed)}</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>{shortKey(snapshot?.poolAuthority)}</dd>
            </div>
          </dl>
        </div>

        <div className="panel log-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Tape</p>
              <h2>Transactions</h2>
            </div>
            {busyLabel && <span className="busy-label">{busyLabel}</span>}
          </div>
          <ol className="log-list">
            {logs.map((entry) => (
              <li key={entry.id} className={entry.tone}>
                <span>{entry.message}</span>
                {entry.signature && <code>{shortKey(entry.signature)}</code>}
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}

export default App;
