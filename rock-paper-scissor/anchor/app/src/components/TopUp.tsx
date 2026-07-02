import { useMemo, useState } from "react";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TOPUP_ENDPOINT, TOPUP_NETWORK_LABEL } from "../lib/config";

/**
 * Top up the burner from a connected wallet. The wallet only SIGNS — we
 * broadcast through TOPUP_ENDPOINT ourselves, because a wallet that
 * broadcasts via its own RPC would send on whatever network it has active.
 *
 * `defaultSol` is the amount this game still needs (play costs + wager), so the
 * one-tap top-up covers exactly what's required to start playing.
 */
export default function TopUp({
  address,
  defaultSol,
}: {
  address: string;
  defaultSol: number;
}) {
  const { publicKey, signTransaction, sendTransaction, connected } =
    useWallet();
  const [amount, setAmount] = useState(defaultSol);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const connection = useMemo(
    () => new Connection(TOPUP_ENDPOINT, "confirmed"),
    [],
  );

  const send = async () => {
    if (!publicKey || busy || amount <= 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(address),
          lamports: Math.round(amount * LAMPORTS_PER_SOL),
        }),
      );
      tx.feePayer = publicKey;
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      let sig: string;
      if (signTransaction) {
        // sign-only path: we control where the tx is submitted
        const signed = await signTransaction(tx);
        sig = await connection.sendRawTransaction(signed.serialize());
      } else {
        // last resort for wallets without signTransaction
        sig = await sendTransaction(tx, connection);
      }
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      setMsg(
        `Topped up ${amount} SOL on ${TOPUP_NETWORK_LABEL} ✅ — the game continues automatically.`,
      );
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setMsg(
        /insufficient|0x1\b/i.test(text)
          ? `Top-up failed: your wallet has no ${TOPUP_NETWORK_LABEL} SOL. Grab some at faucet.solana.com first.`
          : `Top-up failed: ${text}`,
      );
    }
    setBusy(false);
  };

  return (
    <div className="topup">
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
              value={amount}
              onChange={(e) =>
                setAmount(Math.max(0, Number(e.target.value) || 0))
              }
            />
          </label>
          <button
            className="btn btn-primary topup-go"
            onClick={send}
            disabled={busy || amount <= 0}
          >
            {busy ? "Sending…" : `Top up ${amount} SOL 💸`}
          </button>
        </>
      )}
      <p className="fund-msg topup-network">
        Covers this game's needs. Always submits on{" "}
        <strong>{TOPUP_NETWORK_LABEL}</strong> — safe to approve even if your
        wallet warns.
      </p>
      {msg && <p className="fund-msg">{msg}</p>}
    </div>
  );
}
