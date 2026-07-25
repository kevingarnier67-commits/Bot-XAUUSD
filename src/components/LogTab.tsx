// Onglet LOG : terminal du bot — signaux pris/rejetés, régimes, cooldowns,
// halts, reconnexions feed, rattrapages post-suspension.

import { useAppStore } from "../state/store";
import { fmtTime } from "./format";

export function LogTab() {
  const logs = useAppStore((s) => s.logs);

  return (
    <div className="card">
      <h2>Terminal du bot</h2>
      {logs.length === 0 && <div className="empty">Aucun événement pour l'instant</div>}
      <div className="log-terminal">
        {[...logs].reverse().map((l, i) => (
          <div className={`log-line k-${l.kind}`} key={`${l.ts}-${i}`}>
            <span className="ts">{fmtTime(l.ts)}</span>
            <span className="msg">{l.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
