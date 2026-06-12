import { useMemo, useState } from "react";
import { useGameMachine, type GameMode } from "../hooks/useGameMachine";
import Arena from "./Arena";
import ChoicePicker from "./ChoicePicker";
import ShareCard from "./ShareCard";
import ActivityLog from "./ActivityLog";
import TopUp from "./TopUp";
import { shortKey } from "../lib/wallet";

interface Props {
  mode: GameMode;
  onHome: () => void;
  onPlayAgain: () => void;
}

export default function GamePage({ mode, onHome, onPlayAgain }: Props) {
  const m = useGameMachine(mode);
  const [airdropMsg, setAirdropMsg] = useState<string | null>(null);

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
          <button
            className="wallet-badge"
            onClick={copyAddress}
            title={m.myAddress}
          >
            🔑 {shortKey(m.myAddress)}
            {m.balance !== null && (
              <span className="wallet-balance">{m.balance.toFixed(3)} SOL</span>
            )}
          </button>
        )}
      </header>

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
            {m.myAddress && <TopUp address={m.myAddress} />}
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

            {m.phase === "done" && (
              <>
                <div className="btn-row">
                  {!m.settled ? (
                    <>
                      <button className="btn btn-primary" onClick={m.rematch}>
                        Rematch ⚡
                      </button>
                      <button className="btn btn-secondary" onClick={m.settle}>
                        Settle to Solana 🏁
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
                    ? "Result is settled on Solana ✓"
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
