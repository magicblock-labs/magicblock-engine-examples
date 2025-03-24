import * as React from "react";
import { NavigateFunction, useNavigate } from "react-router-dom";

import { MagicBlockEngine } from "../../engine/MagicBlockEngine";
import { useMagicBlockEngine } from "../../engine/MagicBlockEngineProvider";

import { Text } from "../util/Text";
import { ForEach } from "../util/ForEach";

import { gameCreate } from "../../states/gameCreate";
import { GameError } from "../game/GameError";
import { If } from "../util/If";

export function PageCreate() {
  const navigate = useNavigate();
  const engine = useMagicBlockEngine();

  const [error, setError] = React.useState(undefined);
  const [logs, setLogs] = React.useState([]);

  React.useEffect(() => {
    const lastLogs: string[] = [];
    return scheduleCreate(
      navigate,
      engine,
      (log) => {
        lastLogs.push(log);
        setLogs([...lastLogs]);
      },
      (error) => {
        setError(error);
      }
    );
  }, [navigate, engine]);

  if (error) {
    return (
      <div className="Container Centered">
        <GameError message={error} />
      </div>
    );
  }

  return (
    <div className="Container Centered">
      <Text value="Creating a new game" isTitle={true} />
      <Text value="This can take a few moments..." />
      <If
        value={logs.length > 0}
        renderer={() => (
          <div className="Container" style={{ backgroundColor: "grey" }}>
            <ForEach
              values={logs}
              renderer={(log, index) => (
                <Text key={index} value={(index + 1).toString() + ") " + log} />
              )}
            />
          </div>
        )}
      />
    </div>
  );
}

function scheduleCreate(
  navigate: NavigateFunction,
  engine: MagicBlockEngine,
  onLog: (msg: string) => void,
  onError: (msg: string) => void
) {
  const timeout = setTimeout(async () => {
    try {
      const entityPda = await gameCreate(engine, onLog);
      const code = entityPda.toBase58();
      return navigate("/play/" + code);
    } catch (error) {
      console.log("create-error", error);
      onError("Failed to create the game!");
    }
  }, 1000);
  return () => {
    clearTimeout(timeout);
  };
}
