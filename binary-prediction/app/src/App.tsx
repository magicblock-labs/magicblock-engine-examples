import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
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

type Toast = {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  detail: string;
};

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

function settlementOutcome(
  snapshot: MarketSnapshot | null,
  settlementPrice: number,
) {
  if (!snapshot?.direction || snapshot.openPrice === "-") {
    return {
      tone: "info" as const,
      title: "Ticket settled",
      detail: "Settlement confirmed on the ER.",
      log: "Ticket settled",
    };
  }

  const openPrice = Number(snapshot.openPrice);
  if (!Number.isFinite(openPrice) || !Number.isFinite(settlementPrice)) {
    return {
      tone: "info" as const,
      title: "Ticket settled",
      detail: "Settlement confirmed on the ER.",
      log: "Ticket settled",
    };
  }

  if (settlementPrice === openPrice) {
    return {
      tone: "info" as const,
      title: "Stake refunded",
      detail: `Open ${openPrice} matched settle ${settlementPrice}.`,
      log: "Ticket settled: refunded",
    };
  }

  const marketDirection: Direction =
    settlementPrice > openPrice ? "up" : "down";
  const won = marketDirection === snapshot.direction;

  return {
    tone: won ? ("success" as const) : ("error" as const),
    title: won ? "You won" : "You lost",
    detail: `${snapshot.direction.toUpperCase()} ticket vs ${marketDirection.toUpperCase()} move (${openPrice} -> ${settlementPrice}).`,
    log: won ? "Ticket settled: won" : "Ticket settled: lost",
  };
}

function App() {
  const [market, setMarket] = useState<StoredMarket>(() =>
    loadOrCreateMarket(),
  );
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastResult, setLastResult] = useState<Omit<Toast, "id"> | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
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

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [{ ...toast, id }, ...current].slice(0, 3));
    window.setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== id));
    }, 5_000);
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

  const activeDirection = snapshot?.isOpen
    ? (snapshot.direction ?? direction)
    : direction;
  const resultDisplay = lastResult ?? {
    tone: "info" as const,
    title: snapshot?.isOpen ? "Ticket open" : "No result yet",
    detail: snapshot?.isOpen
      ? `${activeDirection.toUpperCase()} ticket opened at ${snapshot.openPrice}.`
      : "Settlement result appears here.",
  };

  const run = useCallback(
    async (label: string, task: () => Promise<void>) => {
      setBusyLabel(label);
      try {
        await task();
        await refresh();
      } catch (error) {
        console.error(error);
        pushLog({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        pushToast({
          tone: "error",
          title: "Transaction failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusyLabel(null);
      }
    },
    [pushLog, pushToast, refresh],
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

  const handlePlaceBet = () =>
    run("Placing prediction", async () => {
      setLastResult(null);
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
      const settlement = numberOrDefault(settlementPrice, 110);
      const outcome = settlementOutcome(snapshot, settlement);
      const signature = await settleBet(market, settlement);
      pushToast({
        tone: outcome.tone,
        title: outcome.title,
        detail: outcome.detail,
      });
      setLastResult({
        tone: outcome.tone,
        title: outcome.title,
        detail: outcome.detail,
      });
      pushLog({
        tone: outcome.tone === "error" ? "error" : "success",
        message: outcome.log,
        signature,
      });
    });

  const handleReset = () => {
    resetStoredMarket();
    const nextMarket = loadOrCreateMarket();
    setMarket(nextMarket);
    setSnapshot(null);
    setLogs(initialLogs);
    setLastResult(null);
    setToasts([]);
    setShowResetModal(false);
  };

  return (
    <main className="terminal">
      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            <strong>{toast.title}</strong>
            <span>{toast.detail}</span>
          </div>
        ))}
      </div>
      {showResetModal && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setShowResetModal(false)}
        >
          <section
            className="reset-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-market-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Reset demo</p>
            <h2 id="reset-market-title">Clear saved market?</h2>
            <p>
              This removes the saved local market from this browser and returns
              the demo to the initialize step.
            </p>
            <div className="modal-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setShowResetModal(false)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={handleReset}
              >
                <RotateCcw size={16} />
                Clear market
              </button>
            </div>
          </section>
        </div>
      )}
      <section className="topbar">
        <div>
          <p className="eyebrow">MagicBlock ER</p>
          <h1>Binary Prediction Demo</h1>
        </div>
        <div className="network-strip" aria-label="Network endpoints">
          <span>Base {BASE_ENDPOINT.replace("http://", "")}</span>
          <span>ER {ER_ENDPOINT.replace("http://", "")}</span>
        </div>
      </section>

      <section className="demo-summary" aria-label="Demo status">
        <div className={`result-card ${resultDisplay.tone}`}>
          <span>Result</span>
          <strong>{resultDisplay.title}</strong>
          <p>{resultDisplay.detail}</p>
        </div>
        <div className="ticket-strip">
          <div>
            <span>Market</span>
            <strong>{marketStatus}</strong>
          </div>
          <div>
            <span>Open</span>
            <strong>{snapshot?.openPrice ?? "-"}</strong>
          </div>
          <div className={`direction-chip ${activeDirection}`}>
            {activeDirection === "up" ? (
              <ArrowUp size={18} />
            ) : (
              <ArrowDown size={18} />
            )}
            {activeDirection.toUpperCase()}
          </div>
          <div>
            <span>Settle</span>
            <strong>{settlementPrice || "-"}</strong>
          </div>
          <div>
            <span>Expiry</span>
            <strong>{expiryLabel(snapshot)}</strong>
          </div>
        </div>
      </section>

      <section className="demo-flow">
        <div className="panel step-card setup-panel">
          <div className="panel-head">
            <div>
              <p className="step-index">1</p>
              <h2>Initialize</h2>
            </div>
            <button
              className="icon-button"
              onClick={() => setShowResetModal(true)}
              disabled={isBusy}
              aria-label="Clear saved market"
            >
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
            onClick={() => setShowResetModal(true)}
            disabled={isBusy}
          >
            <RotateCcw size={16} />
            Clear browser state
          </button>
        </div>

        <div className="panel step-card ticket-panel">
          <div className="panel-head">
            <div>
              <p className="step-index">2</p>
              <h2>Predict</h2>
            </div>
            <div className="ticket-flags">
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
              <Play size={16} />
            )}
            Place bet
          </button>
        </div>

        <div className="panel step-card settle-panel">
          <div className="panel-head">
            <div>
              <p className="step-index">3</p>
              <h2>Settle</h2>
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

      <section className="activity-section">
        <div className="panel log-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Activity</p>
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

        <details className="panel technical-details">
          <summary>Technical details</summary>
          <dl className="account-list">
            <div>
              <dt>User</dt>
              <dd>{shortKey(snapshot?.user)}</dd>
            </div>
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
              <dt>Mint</dt>
              <dd>{shortKey(snapshot?.mint)}</dd>
            </div>
          </dl>
        </details>
      </section>
    </main>
  );
}

export default App;
