import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  BASE_ENDPOINT,
  bootstrapMarket,
  Direction,
  ER_ENDPOINT,
  fetchOraclePrice,
  loadOrCreateMarket,
  LogEntry,
  MarketSnapshot,
  ORACLE_SYMBOL,
  OraclePrice,
  placeBet,
  refreshSnapshot,
  resetStoredMarket,
  settleBet,
  shortKey,
  StoredMarket,
  subscribeOraclePrice,
  TransactionResult,
} from "./lib/binaryPrediction";
import PriceChart from "./components/PriceChart";

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

function isReadyToSettle(snapshot: MarketSnapshot | null) {
  if (!snapshot?.isOpen || snapshot.expiry === "-") return false;
  const expiry = Number(snapshot.expiry);
  return Number.isFinite(expiry) && expiry <= Math.floor(Date.now() / 1000);
}

function formatDuration(milliseconds?: number) {
  if (!milliseconds || !Number.isFinite(milliseconds)) return "";
  if (milliseconds < 1_000) return `${Math.max(1, Math.round(milliseconds))}ms`;
  return `${(milliseconds / 1_000).toFixed(2)}s`;
}

function formatTransactionTiming(result: TransactionResult) {
  return `sent in ${formatDuration(result.sendMs)}`;
}

function formatAmount(value: bigint) {
  return `${value.toString()} token${value === 1n ? "" : "s"}`;
}

function amountSummary(
  snapshot: MarketSnapshot,
  won: boolean,
  refunded = false,
) {
  const stake = BigInt(snapshot.stake);
  if (refunded) return `${formatAmount(stake)} refunded.`;
  if (!won) return `You lost ${formatAmount(stake)}.`;

  const payoutBps = BigInt(snapshot.payoutBps);
  const payout = (stake * payoutBps) / 10_000n;
  const net = payout - stake;
  return `You won ${formatAmount(payout)} (net +${formatAmount(net)}).`;
}

function settlementOutcome(
  snapshot: MarketSnapshot | null,
  settlementPrice?: string,
  result?: TransactionResult,
) {
  const timingDetail = result ? ` ER ${formatTransactionTiming(result)}.` : "";
  if (!snapshot?.direction || snapshot.openPrice === "-") {
    return {
      tone: "info" as const,
      title: "Settlement submitted",
      detail: `Settlement submitted to the ER.${timingDetail}`,
      log: "Settlement submitted",
    };
  }

  const openPrice = Number(snapshot.openPrice);
  const settlePrice = settlementPrice ? Number(settlementPrice) : NaN;
  const hasAmounts =
    /^\d+$/.test(snapshot.stake) && /^\d+$/.test(snapshot.payoutBps);
  if (
    !Number.isFinite(openPrice) ||
    !Number.isFinite(settlePrice) ||
    !hasAmounts
  ) {
    return {
      tone: "info" as const,
      title: "Settlement submitted",
      detail: `Settlement submitted with the live oracle price.${timingDetail}`,
      log: "Settlement submitted",
    };
  }

  if (settlePrice === openPrice) {
    return {
      tone: "info" as const,
      title: "Stake refunded",
      detail: `${amountSummary(snapshot, false, true)} Open ${openPrice} matched settle ${settlePrice}.${timingDetail}`,
      log: "Settlement submitted: refund expected",
    };
  }

  const marketDirection: Direction = settlePrice > openPrice ? "up" : "down";
  const won = marketDirection === snapshot.direction;

  return {
    tone: won ? ("success" as const) : ("error" as const),
    title: won ? "You won" : "You lost",
    detail: `${amountSummary(snapshot, won)} ${snapshot.direction.toUpperCase()} ticket vs ${marketDirection.toUpperCase()} move (${openPrice} -> ${settlePrice}).${timingDetail}`,
    log: won
      ? "Settlement submitted: win expected"
      : "Settlement submitted: loss expected",
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
  const [oraclePrice, setOraclePrice] = useState<OraclePrice | null>(null);
  const [stake, setStake] = useState("100");
  const [duration, setDuration] = useState("8");
  const [direction, setDirection] = useState<Direction>("up");
  const [tick, setTick] = useState(0);
  const autoSettleInFlight = useRef(false);
  const lastAutoSettleAt = useRef(0);

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
    return subscribeOraclePrice(
      (price) => setOraclePrice(price),
      (error) => {
        console.error(error);
        pushLog({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }, [pushLog]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const marketStatus = useMemo(() => {
    if (!isBootstrapped) return "Uninitialized";
    if (snapshot?.isOpen) return "Ticket open";
    return "Ready";
  }, [isBootstrapped, snapshot?.isOpen]);
  const readyToSettle = isReadyToSettle(snapshot);
  // Derive the chart value from the already-normalized display string so it
  // always matches the price shown in the header, regardless of exponent sign.
  const chartPrice = oraclePrice ? Number(oraclePrice.display) : null;

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

      refresh().catch((error) => {
        console.error(error);
        pushLog({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [pushLog, pushToast, refresh],
  );

  const settleCurrentTicket = useCallback(async () => {
    const livePrice = oraclePrice ?? (await fetchOraclePrice());
    const result = await settleBet(market);
    const outcome = settlementOutcome(snapshot, livePrice.raw, result);
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
      message: `${outcome.log}: ER ${formatTransactionTiming(result)}`,
      signature: result.signature,
    });
  }, [market, oraclePrice, pushLog, pushToast, snapshot]);

  const handleBootstrap = () =>
    run("Bootstrapping market", async () => {
      const nextMarket = await bootstrapMarket(market, {
        seedAmount: 10_000,
        userAmount: 1_000,
        durationSeconds: numberOrDefault(duration, 8),
        minStake: 10,
        payoutBps: 19_000,
        onLog: pushLog,
      });
      setMarket(nextMarket);
    });

  const handlePlaceBet = () =>
    run("Placing prediction", async () => {
      setLastResult(null);
      autoSettleInFlight.current = false;
      lastAutoSettleAt.current = 0;
      const result = await placeBet(
        market,
        direction,
        numberOrDefault(stake, 100),
      );
      pushLog({
        tone: "success",
        message: `${direction.toUpperCase()} ticket submitted: ER ${formatTransactionTiming(result)}`,
        signature: result.signature,
      });
    });

  const handleSettle = () =>
    run("Settling ticket", async () => {
      await settleCurrentTicket();
    });

  useEffect(() => {
    if (
      !snapshot?.isOpen ||
      snapshot.expiry === "-" ||
      !oraclePrice ||
      isBusy ||
      autoSettleInFlight.current
    ) {
      return;
    }

    if (!isReadyToSettle(snapshot)) return;

    // Throttle so a premature attempt (ER clock still behind) doesn't spam the
    // rollup with BetNotExpired failures faster than about once per second.
    const nowMs = Date.now();
    if (nowMs - lastAutoSettleAt.current < 750) return;
    lastAutoSettleAt.current = nowMs;

    // The program settles only once the ER clock reaches expiry_ts (which can
    // trail the local clock). A premature attempt fails with BetNotExpired, so
    // we keep quiet on failure and let the next tick retry until it lands —
    // rather than permanently giving up after one attempt.
    autoSettleInFlight.current = true;
    setBusyLabel("Auto-settling ticket");
    settleCurrentTicket()
      .catch((error) => {
        console.debug("Auto-settle retry pending:", error);
      })
      .finally(() => {
        autoSettleInFlight.current = false;
        setBusyLabel(null);
        refresh().catch((error) => {
          console.error(error);
        });
      });
  }, [isBusy, oraclePrice, refresh, settleCurrentTicket, snapshot, tick]);

  const handleReset = () => {
    resetStoredMarket();
    const nextMarket = loadOrCreateMarket();
    setMarket(nextMarket);
    setSnapshot(null);
    setLogs(initialLogs);
    setLastResult(null);
    setToasts([]);
    autoSettleInFlight.current = false;
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
      <div className="viewport">
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

        <section className="board">
          <div className="panel chart-panel">
            <div className="chart-head">
              <div className="chart-price">
                <p className="eyebrow">{ORACLE_SYMBOL}</p>
                <strong className="price-value">
                  {oraclePrice?.display ?? "—"}
                </strong>
                <div className="price-balances">
                  <span>
                    User <b>{snapshot?.userTokens ?? "-"}</b>
                  </span>
                  <span>
                    Pool <b>{snapshot?.poolTokens ?? "-"}</b>
                  </span>
                </div>
              </div>
              <div className="chart-meta">
                <span
                  className={`market-pill ${snapshot?.isOpen ? "open" : "idle"}`}
                >
                  {marketStatus}
                </span>
                {snapshot?.isOpen && (
                  <>
                    <div className="chart-stat">
                      <span>Open</span>
                      <strong>{snapshot.openPrice}</strong>
                    </div>
                    <div className={`direction-chip ${activeDirection}`}>
                      {activeDirection === "up" ? (
                        <ArrowUp size={16} />
                      ) : (
                        <ArrowDown size={16} />
                      )}
                      {activeDirection.toUpperCase()}
                    </div>
                    <div className="chart-stat" key={tick}>
                      <span>Expiry</span>
                      <strong>{expiryLabel(snapshot)}</strong>
                    </div>
                  </>
                )}
              </div>
            </div>
            <PriceChart price={chartPrice} />
          </div>

          <div className="board-rail">
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
              <div className="setup-row">
                <label className="field-compact">
                  Duration (s)
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
                  {isBootstrapped ? "Market ready" : "Initialize market"}
                </button>
              </div>
            </div>

            <div className="panel step-card ticket-panel">
              <div className="panel-head">
                <div>
                  <p className="step-index">2</p>
                  <h2>Predict</h2>
                </div>
                {snapshot?.isOpen ? (
                  <span className="live-pill">Open</span>
                ) : (
                  <span className="quiet-pill">Idle</span>
                )}
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
                disabled={
                  isBusy || !isBootstrapped || Boolean(snapshot?.isOpen)
                }
              >
                {isBusy && busyLabel === "Placing prediction" ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <Play size={16} />
                )}
                Place bet
              </button>
            </div>

            <div className="panel step-card result-panel">
              <div className="panel-head">
                <div>
                  <p className="step-index">3</p>
                  <h2>Result</h2>
                </div>
                <span className="quiet-pill" key={tick}>
                  {expiryLabel(snapshot)}
                </span>
              </div>
              <div className={`result-readout ${resultDisplay.tone}`}>
                <strong>{resultDisplay.title}</strong>
                <p>{resultDisplay.detail}</p>
              </div>
              <button
                className="primary-button settle"
                onClick={handleSettle}
                disabled={isBusy || !readyToSettle || !oraclePrice}
              >
                {isBusy &&
                (busyLabel === "Settling ticket" ||
                  busyLabel === "Auto-settling ticket") ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                Settle now
              </button>
            </div>

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
                    {entry.signature && (
                      <code>{shortKey(entry.signature)}</code>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      </div>

      <details className="panel technical-details">
        <summary>Technical details</summary>
        <dl className="account-list">
          <div>
            <dt>User</dt>
            <dd>
              {shortKey(snapshot?.user)} / {snapshot?.userSol ?? "-"} SOL
            </dd>
          </div>
          <div>
            <dt>Admin</dt>
            <dd>
              {shortKey(snapshot?.admin)} / {snapshot?.adminSol ?? "-"} SOL
            </dd>
          </div>
          <div>
            <dt>Pool PDA</dt>
            <dd>
              {shortKey(snapshot?.poolAuthority)} /{" "}
              {snapshot?.poolAuthoritySol ?? "-"} SOL
            </dd>
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
            <dt>Oracle slot</dt>
            <dd>{oraclePrice?.slot ?? "-"}</dd>
          </div>
          <div>
            <dt>Mint</dt>
            <dd>{shortKey(snapshot?.mint)}</dd>
          </div>
        </dl>
      </details>
    </main>
  );
}

export default App;
