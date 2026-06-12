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
import { TOPUP_SOL, TOPUP_ENDPOINT, TOPUP_NETWORK_LABEL } from "../lib/config";

/**
 * Top up the burner from a connected wallet. The wallet only SIGNS — we
 * broadcast through TOPUP_ENDPOINT ourselves, because a wallet that
 * broadcasts via its own RPC would send on whatever network it has active.
 */
export default function TopUp({ address }: { address: string }) {
  const { publicKey, signTransaction, sendTransaction, connected } =
    useWallet();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const connection = useMemo(
    () => new Connection(TOPUP_ENDPOINT, "confirmed"),
    [],
  );

  const send = async () => {
    if (!publicKey || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(address),
          lamports: Math.round(TOPUP_SOL * LAMPORTS_PER_SOL),
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
        `Topped up ${TOPUP_SOL} SOL on ${TOPUP_NETWORK_LABEL} ✅ — the game continues automatically.`,
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
        {connected && (
          <button className="btn btn-primary" onClick={send} disabled={busy}>
            {busy ? "Sending…" : `Top up ${TOPUP_SOL} SOL 💸`}
          </button>
        )}
      </div>
      <p className="fund-msg topup-network">
        Always submits on <strong>{TOPUP_NETWORK_LABEL}</strong> — safe to
        approve even if your wallet warns.
      </p>
      {msg && <p className="fund-msg">{msg}</p>}
    </div>
  );
}
