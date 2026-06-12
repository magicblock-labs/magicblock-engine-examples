interface Props {
  onSolo: () => void;
  onHost: () => void;
}

export default function Home({ onSolo, onHost }: Props) {
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

        <div className="mode-cards">
          <button className="mode-card" onClick={onSolo}>
            <span className="mode-emoji">🤖</span>
            <span className="mode-title">Solo vs Robot</span>
            <span className="mode-desc">
              The robot makes a secret move of its own
            </span>
          </button>
          <button className="mode-card" onClick={onHost}>
            <span className="mode-emoji">👥</span>
            <span className="mode-title">Challenge a Friend</span>
            <span className="mode-desc">
              Share a link or QR — reveal fires on the last move
            </span>
          </button>
        </div>

        <div className="feature-strip">
          <div className="feature">
            <span>🔒</span> Choices stay private in a TEE
          </div>
          <div className="feature">
            <span>⚡</span> ~50&nbsp;ms moves on an Ephemeral Rollup
          </div>
          <div className="feature">
            <span>🏁</span> Results settle back to Solana
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
