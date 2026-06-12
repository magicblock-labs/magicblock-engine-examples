import { useMemo, useState } from "react";
import Home from "./components/Home";
import GamePage from "./components/GamePage";
import type { GameMode } from "./hooks/useGameMachine";

type View =
  | { page: "home" }
  | { page: "solo"; nonce: number }
  | { page: "host"; nonce: number }
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
        return { kind: "solo" };
      case "host":
        return { kind: "host" };
      case "url":
        return { kind: "url", gameId: view.gameId, join: view.join };
      default:
        return null;
    }
  }, [view]);

  if (view.page === "home" || !mode) {
    return (
      <Home
        onSolo={() => setView({ page: "solo", nonce: Date.now() })}
        onHost={() => setView({ page: "host", nonce: Date.now() })}
      />
    );
  }

  const key =
    view.page === "url" ? `url-${view.gameId}` : `${view.page}-${view.nonce}`;

  return (
    <GamePage
      key={key}
      mode={mode}
      onHome={goHome}
      onPlayAgain={() => {
        if (view.page === "solo") {
          setView({ page: "solo", nonce: Date.now() });
        } else {
          // host & joiner both start a fresh hosted game
          window.history.replaceState(null, "", window.location.pathname);
          setView({ page: "host", nonce: Date.now() });
        }
      }}
    />
  );
}
