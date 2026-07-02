import { useEffect, useState } from "react";
import type { ChoiceName } from "../lib/rps";
import type { Phase, ResultView, Role } from "../hooks/useGameMachine";
import { CHOICE_EMOJI, CHOICE_LABEL } from "./ChoicePicker";

interface Props {
  phase: Phase;
  role: Role;
  myChoice: ChoiceName | null;
  result: ResultView | null;
  opponentJoined: boolean;
  opponentLocked: boolean;
}

// Countdown beats: the hands morph through rock/paper/scissors in sync with
// the words, then snap to the real throws on "Shoot!".
const BEATS = [
  { word: "Rock…", hand: "✊" },
  { word: "Paper…", hand: "✋" },
  { word: "Scissors…", hand: "✌️" },
  { word: "Shoot! 💥", hand: null }, // null → show the actual choices
];
const BEAT_MS = 650;

const FLAVOR: Record<string, string> = {
  "rock-scissors": "✊ Rock crushes Scissors",
  "paper-rock": "✋ Paper wraps Rock",
  "scissors-paper": "✌️ Scissors cut Paper",
};

function flavorLine(r: ResultView): string {
  if (r.outcome === "tie") return "Great minds think alike 🧠";
  const [w, l] = r.outcome === "win" ? [r.me, r.them] : [r.them, r.me];
  return FLAVOR[`${w}-${l}`] ?? "";
}

export default function Arena({
  phase,
  role,
  myChoice,
  result,
  opponentJoined,
  opponentLocked,
}: Props) {
  const opponentName = role === "solo" ? "Robot 🤖" : "Challenger";
  const revealing = phase === "revealing";
  // "round-over" shows the just-finished round's hands, like the final screen.
  const done = phase === "done" || phase === "round-over";

  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!revealing) {
      setBeat(0);
      return;
    }
    const t = window.setInterval(
      () => setBeat((b) => Math.min(b + 1, BEATS.length - 1)),
      BEAT_MS,
    );
    return () => window.clearInterval(t);
  }, [revealing]);

  const shoot = !BEATS[beat].hand; // final beat

  const myFace =
    (done || (revealing && shoot)) && result
      ? CHOICE_EMOJI[result.me]
      : revealing
        ? BEATS[beat].hand!
        : myChoice
          ? CHOICE_EMOJI[myChoice]
          : "❓";
  const theirFace =
    (done || (revealing && shoot)) && result
      ? CHOICE_EMOJI[result.them]
      : revealing
        ? BEATS[beat].hand!
        : opponentJoined || role === "solo"
          ? "🔒"
          : "💤";
  const theirCaption = done
    ? result
      ? CHOICE_LABEL[result.them]
      : ""
    : role === "solo"
      ? opponentLocked
        ? "Locked in!"
        : "Thinking…"
      : opponentJoined
        ? "Encrypted in the TEE"
        : "Waiting to join…";
  const myCaption = done
    ? result
      ? CHOICE_LABEL[result.me]
      : ""
    : myChoice
      ? "Only you can see it"
      : "Pick your hand";

  // key={beat} remounts the inner span every beat so its bounce/pop animation
  // restarts in sync with the word change.
  const hand = (face: string) => (
    <span
      key={revealing ? beat : done ? "done" : "idle"}
      className={`fist-inner ${revealing ? (shoot ? "pop" : "beat") : ""}`}
    >
      {face}
    </span>
  );

  return (
    <div className="arena">
      <div
        className={`fighter ${done && result?.outcome === "win" ? "winner" : ""}`}
      >
        <div className="fighter-name">You</div>
        <div className="fist">{hand(myFace)}</div>
        <div className="fighter-caption">{revealing ? "" : myCaption}</div>
      </div>

      <div className="versus">
        {revealing ? (
          <span className="shout" key={beat}>
            {BEATS[beat].word}
          </span>
        ) : done && result ? (
          <span className={`outcome outcome-${result.outcome}`}>
            {result.outcome === "win"
              ? "YOU WIN! 🏆"
              : result.outcome === "lose"
                ? "You lose 😵"
                : "It's a tie 🤝"}
          </span>
        ) : (
          <span className="vs">VS</span>
        )}
        {done && result && <span className="flavor">{flavorLine(result)}</span>}
      </div>

      <div
        className={`fighter ${done && result?.outcome === "lose" ? "winner" : ""}`}
      >
        <div className="fighter-name">{opponentName}</div>
        <div className="fist mirrored">{hand(theirFace)}</div>
        <div className="fighter-caption">{revealing ? "" : theirCaption}</div>
      </div>
    </div>
  );
}
