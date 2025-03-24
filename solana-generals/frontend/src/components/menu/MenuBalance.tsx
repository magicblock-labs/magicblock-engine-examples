import * as React from "react";

import { PublicKey } from "@solana/web3.js";

import { useMagicBlockEngine } from "../../engine/MagicBlockEngineProvider";

import { Button } from "../util/Button";

export function MenuBalance({
  name,
  publicKey,
}: {
  name: string;
  publicKey: PublicKey;
}) {
  const engine = useMagicBlockEngine();

  const [lamports, setLamports] = React.useState(undefined);
  React.useEffect(() => {
    return engine.subscribeToChainAccountInfo(publicKey, (accountInfo) => {
      setLamports(accountInfo?.lamports);
    });
  }, [engine]);

  const abbreviation = publicKey.toBase58().substring(0, 8);
  const sols =
    lamports !== undefined ? (lamports / 1_000_000_000).toFixed(3) : "?????";

  return (
    <Button
      text={name + ": " + abbreviation + "... " + sols + " SOL"}
      onClick={() => {
        navigator.clipboard.writeText(publicKey.toBase58());
      }}
      isSoft={true}
    />
  );
}
