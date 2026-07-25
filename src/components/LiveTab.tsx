// Onglet LIVE : prix bid/ask temps réel, équité, chips d'état, positions, mini chart.

import { useAppStore } from "../state/store";
import type { BotStatus, Position, Tick } from "../engine/types";
import { CONTRACT_SIZE } from "../engine/risk";
import { fmtPrice, fmtSignedUsd, fmtTime, fmtUsd, pnlClass } from "./format";
import { TickChart } from "./TickChart";

const STATUS_LABEL: Record<BotStatus, { label: string; cls: string }> = {
  RUNNING: { label: "Running", cls: "running" },
  COOLDOWN: { label: "Cooldown", cls: "cooldown" },
  HALTED: { label: "Halted", cls: "halted" },
  MARKET_CLOSED: { label: "Marché fermé", cls: "closed" },
};

function unrealized(p: Position, tick: Tick): number {
  const mark = p.side === "BUY" ? tick.bid : tick.ask;
  const diff = p.side === "BUY" ? mark - p.entryPrice : p.entryPrice - mark;
  return diff * p.lots * CONTRACT_SIZE + p.swapAccrued - p.commission;
}

export function LiveTab() {
  const tick = useAppStore((s) => s.tick);
  const ticks = useAppStore((s) => s.ticks);
  const status = useAppStore((s) => s.status);
  const regime = useAppStore((s) => s.regime);
  const sourceName = useAppStore((s) => s.sourceName);
  const equity = useAppStore((s) => s.equity);
  const initialCapital = useAppStore((s) => s.initialCapital);
  const positions = useAppStore((s) => s.positions);

  const st = STATUS_LABEL[status];
  const pnlTotal = equity - initialCapital;

  return (
    <>
      <div className="card">
        <div className="price-block">
          <div className="price-mid">{tick ? fmtPrice(tick.mid) : "----.--"}</div>
          <div className="price-ba">
            <span className="bid">BID {tick ? fmtPrice(tick.bid) : "--"}</span>
            <span className="ask">ASK {tick ? fmtPrice(tick.ask) : "--"}</span>
          </div>
          <div className="price-ba" style={{ marginTop: 2 }}>
            <span>
              source <b style={{ color: "var(--gold)" }}>{sourceName}</b>
              {tick ? ` · ${fmtTime(tick.ts)}` : ""}
            </span>
          </div>
        </div>
        <div className="chips">
          <span className={`chip ${st.cls}`}>{st.label}</span>
          {regime && <span className="chip neutral">{regime}</span>}
        </div>
      </div>

      <div className="card">
        <h2>Équité</h2>
        <div className="equity-line">
          <span className="label">Équité</span>
          <span className="value gold">{fmtUsd(equity)}</span>
        </div>
        <div className="equity-line">
          <span className="label">P&amp;L total</span>
          <span className={`value ${pnlClass(pnlTotal)}`}>{fmtSignedUsd(pnlTotal)}</span>
        </div>
      </div>

      <div className="card">
        <h2>Ticks récents</h2>
        <TickChart ticks={ticks} />
      </div>

      <div className="card">
        <h2>Positions ouvertes ({positions.length}/3)</h2>
        {positions.length === 0 && <div className="empty">Aucune position ouverte</div>}
        {positions.map((p) => {
          const upnl = tick ? unrealized(p, tick) : 0;
          return (
            <div className="position-row" key={p.id}>
              <span className={`side-badge ${p.side === "BUY" ? "buy" : "sell"}`}>
                {p.side}
              </span>
              <div>
                <div>
                  {p.lots} lot @ {fmtPrice(p.entryPrice)}
                </div>
                <div className="meta">
                  {p.strategy} · SL {fmtPrice(p.sl)} · TP {fmtPrice(p.tp)} · depuis{" "}
                  {fmtTime(p.openTs)}
                </div>
              </div>
              <span className={`pnl ${pnlClass(upnl)}`}>{fmtSignedUsd(upnl)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
