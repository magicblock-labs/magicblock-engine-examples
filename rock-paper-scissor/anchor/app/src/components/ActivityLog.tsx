import type { LogEntry, LogLayer } from "../hooks/useGameMachine";
import { baseExplorerTxUrl } from "../lib/config";
import { shortKey } from "../lib/wallet";

const LAYER_LABEL: Record<LogLayer, string> = {
  base: "Solana",
  tee: "TEE",
  settle: "TEE → Solana",
};

const STATUS_ICON = { pending: "", ok: "✅", err: "⚠️" } as const;

interface Props {
  entries: LogEntry[];
  /** Builds a tokenized TEE explorer link for ER txs (null until authed). */
  erTxUrl?: (sig: string) => string | null;
}

export default function ActivityLog({ entries, erTxUrl }: Props) {
  if (entries.length === 0) return null;
  return (
    <div className="card activity-log">
      <h3>Under the hood ⚙️</h3>
      <ul>
        {entries.map((e) => {
          const url = e.sig
            ? e.layer === "base"
              ? baseExplorerTxUrl(e.sig)
              : (erTxUrl?.(e.sig) ?? null)
            : null;
          return (
            <li key={e.id} className={`log-entry ${e.status}`}>
              <span className="log-icon">
                {e.status === "pending" ? (
                  <span className="spinner" />
                ) : (
                  STATUS_ICON[e.status]
                )}
              </span>
              <span className={`layer-badge layer-${e.layer}`}>
                {LAYER_LABEL[e.layer]}
              </span>
              <span className="log-text">{e.text}</span>
              {e.sig &&
                (url ? (
                  <a
                    className="log-sig"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    title={
                      e.layer === "base"
                        ? e.sig
                        : `${e.sig} — viewable with your TEE auth token`
                    }
                  >
                    {shortKey(e.sig)} ↗
                  </a>
                ) : (
                  <span className="log-sig" title={e.sig}>
                    {shortKey(e.sig)}
                  </span>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
