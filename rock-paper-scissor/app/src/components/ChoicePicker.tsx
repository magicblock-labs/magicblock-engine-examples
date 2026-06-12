import type { ChoiceName } from "../lib/rps";

export const CHOICE_EMOJI: Record<ChoiceName, string> = {
  rock: "✊",
  paper: "✋",
  scissors: "✌️",
};

export const CHOICE_LABEL: Record<ChoiceName, string> = {
  rock: "Rock",
  paper: "Paper",
  scissors: "Scissors",
};

interface Props {
  onPick: (c: ChoiceName) => void;
  disabled?: boolean;
  selected?: ChoiceName | null;
}

export default function ChoicePicker({ onPick, disabled, selected }: Props) {
  return (
    <div className="picker">
      <p className="picker-hint">
        {disabled ? "Locking in…" : "Throw your hand — it stays secret 🤫"}
      </p>
      <div className="picker-row">
        {(Object.keys(CHOICE_EMOJI) as ChoiceName[]).map((c) => (
          <button
            key={c}
            className={`choice-btn ${selected === c ? "selected" : ""}`}
            onClick={() => onPick(c)}
            disabled={disabled}
          >
            <span className="choice-emoji">{CHOICE_EMOJI[c]}</span>
            <span className="choice-label">{CHOICE_LABEL[c]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
