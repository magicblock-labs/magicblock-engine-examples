import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { WITHDRAW_RESERVE_SOL } from "../lib/config";
import { shortKey } from "../lib/wallet";

interface Props {
  balance: number | null;
  onWithdraw: (to: PublicKey, sol: number) => Promise<string>;
  onClose: () => void;
}

/** Cash the burner's balance back out to a connected wallet. */
export default function Withdraw({ balance, onWithdraw, onClose }: Props) {
  const { publicKey, connected } = useWallet();
  const max = Math.max(0, (balance ?? 0) - WITHDRAW_RESERVE_SOL);
  const [amount, setAmount] = useState(max);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const send = async () => {
    if (!publicKey || busy || amount <= 0) return;
    setBusy(true);
    setMsg(null);
    try {
      await onWithdraw(publicKey, amount);
      setMsg(`Sent ${amount.toFixed(4)} SOL to ${shortKey(publicKey)} ✅`);
    } catch (e) {
      setMsg(`Withdraw failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card withdraw-card" onClick={(e) => e.stopPropagation()}>
        <h3>Withdraw to your wallet 🏧</h3>
        <p className="fund-msg">
          Move SOL from this game's burner wallet to your own wallet. Balance:{" "}
          <strong>{(balance ?? 0).toFixed(4)} SOL</strong>
        </p>

        <div className="topup-row">
          <WalletMultiButton />
        </div>
        {connected && (
          <>
            <label className="stake-custom">
              Amount (SOL)
              <input
                type="number"
                min={0}
                step={0.01}
                max={max}
                value={amount}
                onChange={(e) =>
                  setAmount(
                    Math.min(max, Math.max(0, Number(e.target.value) || 0)),
                  )
                }
              />
            </label>
            <button className="link-btn" onClick={() => setAmount(max)}>
              Max ({max.toFixed(4)} SOL)
            </button>
            <button
              className="btn btn-primary topup-go"
              onClick={send}
              disabled={busy || amount <= 0}
            >
              {busy ? "Sending…" : `Withdraw ${amount.toFixed(3)} SOL`}
            </button>
          </>
        )}
        <p className="fund-msg topup-network">
          A little SOL is kept back for fees. Make sure your wallet is on the
          same network.
        </p>
        {msg && <p className="fund-msg">{msg}</p>}

        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
