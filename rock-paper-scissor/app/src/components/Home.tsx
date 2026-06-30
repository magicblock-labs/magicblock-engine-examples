import { useState } from "react";
import {
  DEFAULT_STAKE_SOL,
  STAKE_PRESETS_SOL,
  BEST_OF_PRESETS,
  DEFAULT_BEST_OF,
} from "../lib/config";

interface Props {
  onStart: (kind: "solo" | "host", stakeSol: number, bestOf: number) => void;
}

export default function Home({ onStart }: Props) {
  const [picking, setPicking] = useState<"solo" | "host" | null>(null);
  const [stake, setStake] = useState(DEFAULT_STAKE_SOL);
  const [bestOf, setBestOf] = useState(DEFAULT_BEST_OF);

  return (
    <div className="page home">
      <div className="floaters" aria-hidden>
        <span style={{ left: "8%", animationDelay: "0s" }}>✊</span>
        <span style={{ left: "28%", animationDelay: "2.2s" }}>✋</span>
        <span style={{ left: "55%", animationDelay: "1.1s" }}>✌️</span>
        <span style={{ left: "78%", animationDelay: "3.4s" }}>⚡</span>
        <span style={{ left: "90%", animationDelay: "0.7s" }}>🔒</span>
      </div>

      <main className="home-hero">
        <div className="hero-hands">
          <span className="hand wiggle">✊</span>
          <span className="hand wiggle d1">✋</span>
          <span className="hand wiggle d2">✌️</span>
        </div>
        <h1 className="title">Rock · Paper · Scissors</h1>
        <p className="subtitle">
          Confidential PvP on Solana — moves stay{" "}
          <strong>encrypted in a TEE</strong> until both players throw.
        </p>

        {!picking ? (
          <div className="mode-cards">
            <button className="mode-card" onClick={() => setPicking("solo")}>
              <span className="mode-emoji">🤖</span>
              <span className="mode-title">Solo vs Robot</span>
              <span className="mode-desc">
                The robot makes a secret move of its own
              </span>
            </button>
            <button className="mode-card" onClick={() => setPicking("host")}>
              <span className="mode-emoji">👥</span>
              <span className="mode-title">Challenge a Friend</span>
              <span className="mode-desc">
                Share a link or QR — reveal fires on the last move
              </span>
            </button>
          </div>
        ) : (
          <StakeChooser
            mode={picking}
            stake={stake}
            setStake={setStake}
            bestOf={bestOf}
            setBestOf={setBestOf}
            onBack={() => setPicking(null)}
            onStart={() => onStart(picking, stake, bestOf)}
          />
        )}

        <div className="feature-strip">
          <div className="feature">
            <span>🔒</span> Choices stay private in a TEE
          </div>
          <div className="feature">
            <span>⚡</span> ~50&nbsp;ms moves on an Ephemeral Rollup
          </div>
          <div className="feature">
            <span>🏆</span> Winner takes the pot, settled on Solana
          </div>
        </div>
      </main>

      <footer className="footer">
        Built with the{" "}
        <a href="https://docs.magicblock.gg" target="_blank" rel="noreferrer">
          MagicBlock Ephemeral Rollups SDK
        </a>
      </footer>
    </div>
  );
}

interface ChooserProps {
  mode: "solo" | "host";
  stake: number;
  setStake: (n: number) => void;
  bestOf: number;
  setBestOf: (n: number) => void;
  onBack: () => void;
  onStart: () => void;
}

function StakeChooser({
  mode,
  stake,
  setStake,
  bestOf,
  setBestOf,
  onBack,
  onStart,
}: ChooserProps) {
  const winsNeeded = Math.ceil(bestOf / 2);
  return (
    <div className="card stake-card">
      <h3>{mode === "solo" ? "🤖 Solo vs Robot" : "👥 Challenge a Friend"}</h3>

      <div className="stake-section">
        <p className="stake-sub">Match length — first to win the majority.</p>
        <div className="stake-presets">
          {BEST_OF_PRESETS.map((n) => (
            <button
              key={n}
              className={`stake-preset ${bestOf === n ? "selected" : ""}`}
              onClick={() => setBestOf(n)}
            >
              {n === 1 ? "Single" : `Best of ${n}`}
            </button>
          ))}
        </div>
        <label className="stake-custom">
          Custom (rounds)
          <input
            type="number"
            min={1}
            step={2}
            value={bestOf}
            onChange={(e) =>
              setBestOf(Math.max(1, Math.floor(Number(e.target.value) || 1)))
            }
          />
        </label>
        <p className="stake-pot">
          {bestOf === 1
            ? "One round decides it"
            : `First to ${winsNeeded} wins`}
        </p>
      </div>

      <div className="stake-section">
        <p className="stake-sub">
          Set the wager — each player stakes this, the match winner takes the
          pot.
        </p>
        <div className="stake-presets">
          {STAKE_PRESETS_SOL.map((s) => (
            <button
              key={s}
              className={`stake-preset ${stake === s ? "selected" : ""}`}
              onClick={() => setStake(s)}
            >
              {s === 0 ? "Free" : `${s} SOL`}
            </button>
          ))}
        </div>
        <label className="stake-custom">
          Custom (SOL)
          <input
            type="number"
            min={0}
            step={0.01}
            value={stake}
            onChange={(e) => setStake(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
        <p className="stake-pot">
          {stake > 0 ? (
            <>
              Pot: <strong>{(stake * 2).toFixed(3)} SOL</strong>
            </>
          ) : (
            "Free play — no SOL at stake"
          )}
        </p>
      </div>

      <div className="btn-row">
        <button className="btn btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <button className="btn btn-primary" onClick={onStart}>
          {mode === "solo" ? "Play 🎮" : "Create game 🎮"}
        </button>
      </div>
    </div>
  );
}
