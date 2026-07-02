import { useMemo, useState } from "react";
import { useGameMachine, type GameMode } from "../hooks/useGameMachine";
import Arena from "./Arena";
import ChoicePicker from "./ChoicePicker";
import ShareCard from "./ShareCard";
import ActivityLog from "./ActivityLog";
import TopUp from "./TopUp";
import Withdraw from "./Withdraw";
import { shortKey } from "../lib/wallet";

interface Props {
  mode: GameMode;
  onHome: () => void;
  onPlayAgain: () => void;
}

export default function GamePage({ mode, onHome, onPlayAgain }: Props) {
  const m = useGameMachine(mode);
  const [airdropMsg, setAirdropMsg] = useState<string | null>(null);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const staked = m.stakeSol > 0;
  const bestOf = m.targetWins * 2 - 1;
  const isMatch = m.targetWins > 1;

  // Default top-up = what this game still needs (play costs + wager) over the
  // current balance, plus a little fee headroom, rounded up to 0.001 SOL.
  const shortfall = Math.max(0, m.fundNeededSol - (m.balance ?? 0));
  const topUpDefault = Math.max(
    0.01,
    Math.ceil((shortfall + 0.005) * 1000) / 1000,
  );

  const confetti = useMemo(() => {
    if (m.phase !== "done" || m.result?.outcome !== "win") return null;
    return Array.from({ length: 70 }, (_, i) => (
      <span
        key={i}
        className="confetto"
        style={{
          left: `${Math.random() * 100}%`,
          background: `hsl(${Math.floor(Math.random() * 360)}, 90%, 60%)`,
          animationDelay: `${Math.random() * 1.2}s`,
          animationDuration: `${2.2 + Math.random() * 1.8}s`,
          transform: `rotate(${Math.random() * 360}deg)`,
        }}
      />
    ));
  }, [m.phase, m.result]);

  const showShare =
    m.role === "host" &&
    !!m.shareUrl &&
    !m.opponent &&
    ["pick", "submitting", "waiting"].includes(m.phase);

  const copyAddress = () => {
    if (m.myAddress)
      navigator.clipboard?.writeText(m.myAddress).catch(() => {});
  };

  const requestDrop = async () => {
    setAirdropMsg("Requesting airdrop…");
    try {
      await m.airdrop();
      setAirdropMsg("Airdrop landed 🪂");
    } catch {
      setAirdropMsg("Faucet refused — try faucet.solana.com instead.");
    }
  };

  return (
    <div className="page game">
      {confetti && <div className="confetti">{confetti}</div>}

      <header className="game-header">
        <button className="btn btn-ghost" onClick={onHome}>
          ← Home
        </button>
        <div className="game-meta">
          {m.gameIdStr && <span className="game-id">Game #{m.gameIdStr}</span>}
        </div>
        {m.myAddress && (
          <div className="wallet-area">
            <button
              className="wallet-badge"
              onClick={copyAddress}
              title={m.myAddress}
            >
              🔑 {shortKey(m.myAddress)}
              {m.balance !== null && (
                <span className="wallet-balance">
                  {m.balance.toFixed(3)} SOL
                </span>
              )}
            </button>
            <button
              className="btn btn-ghost withdraw-link"
              onClick={() => setShowWithdraw(true)}
            >
              Withdraw 🏧
            </button>
          </div>
        )}
      </header>

      {staked && m.gameIdStr && (
        <div className="pot-banner">
          💰 Wager <strong>{m.stakeSol} SOL</strong> each · Pot{" "}
          <strong>{m.potSol.toFixed(3)} SOL</strong> · winner takes all
        </div>
      )}

      {isMatch && m.gameIdStr && (
        <div className="score-banner">
          <span className="score-label">Best of {bestOf}</span>
          <span className="score-nums">
            You <strong>{m.myWins}</strong> — <strong>{m.theirWins}</strong>{" "}
            {m.role === "solo" ? "Robot" : "Opp"}
          </span>
          {!m.matchOver && <span className="score-round">Round {m.round}</span>}
        </div>
      )}

      {showWithdraw && (
        <Withdraw
          balance={m.balance}
          onWithdraw={m.withdraw}
          onClose={() => setShowWithdraw(false)}
        />
      )}

      <main className="game-main">
        {m.phase === "loading" && (
          <div className="center-state">
            <div className="big-spinner">✊</div>
            <p>Warming up the rollup…</p>
          </div>
        )}

        {m.phase === "needs-funds" && (
          <div className="card fund-card">
            <h3>Fuel up your burner wallet ⛽</h3>
            <p>
              You play from a throwaway wallet in your browser — it needs a
              little devnet SOL.
            </p>
            <code
              className="address"
              onClick={copyAddress}
              title="Click to copy"
            >
              {m.myAddress}
            </code>
            <div className="fund-row">
              <span className="fund-balance">
                Balance: {(m.balance ?? 0).toFixed(4)} SOL
              </span>
              <button className="btn btn-secondary" onClick={requestDrop}>
                Request airdrop 🪂
              </button>
            </div>
            {airdropMsg && <p className="fund-msg">{airdropMsg}</p>}
            <div className="fund-divider">or top up from your wallet</div>
            {m.myAddress && (
              <TopUp address={m.myAddress} defaultSol={topUpDefault} />
            )}
            <p className="fund-msg">
              The game continues automatically once funds arrive.
            </p>
          </div>
        )}

        {m.phase === "error" && (
          <div className="card error-card">
            <h3>Whoops 💥</h3>
            <p>{m.error}</p>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={onPlayAgain}>
                Try a new game
              </button>
              <button className="btn btn-secondary" onClick={onHome}>
                Home
              </button>
            </div>
          </div>
        )}

        {[
          "setting-up",
          "pick",
          "submitting",
          "waiting",
          "revealing",
          "round-over",
          "done",
        ].includes(m.phase) && (
          <>
            <Arena
              phase={m.phase}
              role={m.role}
              myChoice={m.myChoice}
              result={m.result}
              opponentJoined={!!m.opponent}
              opponentLocked={m.opponentLocked}
            />

            {m.phase === "setting-up" && (
              <p className="status-line pulse">
                Setting up the board on-chain…
              </p>
            )}

            {(m.phase === "pick" || m.phase === "submitting") && (
              <ChoicePicker
                onPick={m.pick}
                disabled={m.phase === "submitting"}
                selected={m.myChoice}
              />
            )}

            {m.phase === "waiting" && (
              <p className="status-line pulse">
                {m.role === "solo"
                  ? "Choices are in — revealing…"
                  : m.opponent
                    ? "Waiting for the opponent's throw ⚡"
                    : "Waiting for a challenger…"}
              </p>
            )}

            {m.phase === "round-over" && (
              <p className="status-line pulse">
                {m.result?.outcome === "win"
                  ? "You took that round! "
                  : m.result?.outcome === "lose"
                    ? "Lost that round. "
                    : "Tied round — replaying. "}
                Next round starting…
              </p>
            )}

            {m.phase === "done" && (
              <>
                <div className="btn-row">
                  {!m.settled ? (
                    <>
                      {/* Free games can rematch on the same PDAs; with a wager
                          on the line, each game settles decisively. */}
                      {!staked && (
                        <button className="btn btn-primary" onClick={m.rematch}>
                          Rematch ⚡
                        </button>
                      )}
                      <button
                        className={`btn ${staked ? "btn-primary" : "btn-secondary"}`}
                        onClick={m.settle}
                      >
                        {staked
                          ? "Settle & claim pot 💰"
                          : "Settle to Solana 🏁"}
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-primary" onClick={onPlayAgain}>
                      New game 🔄
                    </button>
                  )}
                  <button className="btn btn-ghost" onClick={onHome}>
                    Home
                  </button>
                </div>
                <p className="status-line">
                  {m.settled
                    ? staked
                      ? m.result?.outcome === "win"
                        ? "You won the pot! Withdraw it to your wallet 🏧"
                        : m.result?.outcome === "tie"
                          ? "Tie — stakes refunded, settled on Solana ✓"
                          : "Settled on Solana ✓"
                      : "Result is settled on Solana ✓"
                    : staked
                      ? "Settle to pay out the pot to the winner 💰"
                      : "Rematch reuses the same accounts — no new rent ⚡"}
                </p>
              </>
            )}

            {showShare && m.shareUrl && <ShareCard url={m.shareUrl} />}
          </>
        )}

        <ActivityLog entries={m.log} erTxUrl={m.erExplorerUrl} />
      </main>
    </div>
  );
}
