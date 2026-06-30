import { useMemo, useState } from "react";
import Home from "./components/Home";
import GamePage from "./components/GamePage";
import type { GameMode } from "./hooks/useGameMachine";
import { DEFAULT_STAKE_SOL, DEFAULT_BEST_OF } from "./lib/config";

type View =
  | { page: "home" }
  | { page: "solo"; nonce: number; stakeSol: number; bestOf: number }
  | { page: "host"; nonce: number; stakeSol: number; bestOf: number }
  | { page: "url"; gameId: string; join: boolean };

const initialView = (): View => {
  const params = new URLSearchParams(window.location.search);
  const gameId = params.get("game");
  if (gameId && /^\d+$/.test(gameId)) {
    return { page: "url", gameId, join: params.get("join") === "1" };
  }
  return { page: "home" };
};

export default function App() {
  const [view, setView] = useState<View>(initialView);

  const goHome = () => {
    window.history.replaceState(null, "", window.location.pathname);
    setView({ page: "home" });
  };

  const mode: GameMode | null = useMemo(() => {
    switch (view.page) {
      case "solo":
        return { kind: "solo", stakeSol: view.stakeSol, bestOf: view.bestOf };
      case "host":
        return { kind: "host", stakeSol: view.stakeSol, bestOf: view.bestOf };
      case "url":
        return { kind: "url", gameId: view.gameId, join: view.join };
      default:
        return null;
    }
  }, [view]);

  if (view.page === "home" || !mode) {
    return (
      <Home
        onStart={(kind, stakeSol, bestOf) =>
          setView({ page: kind, nonce: Date.now(), stakeSol, bestOf })
        }
      />
    );
  }

  const key =
    view.page === "url" ? `url-${view.gameId}` : `${view.page}-${view.nonce}`;

  const lastStake = view.page === "url" ? DEFAULT_STAKE_SOL : view.stakeSol;
  const lastBestOf = view.page === "url" ? DEFAULT_BEST_OF : view.bestOf;

  return (
    <GamePage
      key={key}
      mode={mode}
      onHome={goHome}
      onPlayAgain={() => {
        if (view.page === "solo") {
          setView({
            page: "solo",
            nonce: Date.now(),
            stakeSol: lastStake,
            bestOf: lastBestOf,
          });
        } else {
          // host & joiner both start a fresh hosted game
          window.history.replaceState(null, "", window.location.pathname);
          setView({
            page: "host",
            nonce: Date.now(),
            stakeSol: lastStake,
            bestOf: lastBestOf,
          });
        }
      }}
    />
  );
}
