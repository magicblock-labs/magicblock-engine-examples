import * as React from "react";

import { useMagicBlockEngine } from "../../engine/MagicBlockEngineProvider";

import { Button } from "../util/Button";
import { Text } from "../util/Text";
import { ForEach } from "../util/ForEach";

import { MenuBalance } from "./MenuBalance";

export function MenuWallet() {
  const engine = useMagicBlockEngine();
  if (engine.getWalletConnected()) {
    return <MenuWalletConnected />;
  } else {
    return <MenuWalletDisconnected />;
  }
}

function MenuWalletConnected() {
  const engine = useMagicBlockEngine();
  return (
    <div className="ContainerInner Centered Horizontal">
      <MenuBalance name="Wallet" publicKey={engine.getWalletPayer()} />
      <Button
        text="X"
        onClick={() => {
          engine.selectWalletAdapter(null);
        }}
      />
    </div>
  );
}

function MenuWalletDisconnected() {
  const engine = useMagicBlockEngine();
  return (
    <div className="ContainerInner Centered Horizontal">
      <ForEach
        values={engine.listWalletAdapters()}
        before={() => <Text value="Connect:" />}
        renderer={(walletAdapter) => (
          <Button
            key={walletAdapter.name}
            icon={walletAdapter.icon}
            text={walletAdapter.name}
            onClick={() => {
              engine.selectWalletAdapter(walletAdapter);
            }}
          />
        )}
        placeholder={() => <Text value="No web wallet detected" />}
      />
    </div>
  );
}
