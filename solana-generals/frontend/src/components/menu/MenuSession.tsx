import * as React from "react";

import { useMagicBlockEngine } from "../../engine/MagicBlockEngineProvider";

import { Text } from "../util/Text";
import { Button } from "../util/Button";

import { MenuBalance } from "./MenuBalance";

export function MenuSession() {
  const engine = useMagicBlockEngine();

  const sessionPayer = engine.getSessionPayer();

  const [sessionLamports, setSessionLamports] = React.useState(undefined);
  React.useEffect(() => {
    return engine.subscribeToChainAccountInfo(sessionPayer, (accountInfo) => {
      setSessionLamports(accountInfo?.lamports);
    });
  }, [engine]);

  const needsFunding =
    sessionLamports !== undefined
      ? sessionLamports < engine.getSessionMinLamports()
      : true;

  const extras = [];
  if (engine.getWalletConnected() && needsFunding) {
    const onFund = async () => {
      await engine.fundSessionFromWallet();
      console.log("funded");
    };
    extras.push(<Button key="fund" text="Fund" onClick={onFund} />);
  }
  if (needsFunding) {
    extras.push(<Text key="warning" value="Need SOL!" isWarning={true} />);
  }

  return (
    <div className="ContainerInner Centered Horizontal">
      <MenuBalance name="Player" publicKey={sessionPayer} />
      {extras}
    </div>
  );
}
