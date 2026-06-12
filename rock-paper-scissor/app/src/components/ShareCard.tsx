import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface Props {
  url: string;
}

export default function ShareCard({ url }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard can be unavailable over plain http — show the url instead
      window.prompt("Copy the invite link:", url);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="card share-card">
      <h3>Invite a challenger 🥊</h3>
      <div className="qr-wrap">
        <QRCodeSVG value={url} size={168} marginSize={2} />
      </div>
      <p className="share-hint">
        Scan or send the link — the reveal fires when they pick.
      </p>
      <button className="btn btn-secondary" onClick={copy}>
        {copied ? "Copied! ✅" : "Copy invite link 🔗"}
      </button>
    </div>
  );
}
