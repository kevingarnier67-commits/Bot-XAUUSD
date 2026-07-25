// Onglet AUDIT : trades fermés avec Decision Logic dépliable.

import { useState } from "react";
import { useAppStore } from "../state/store";
import type { CloseReason } from "../engine/types";
import { fmtDateTime, fmtDuration, fmtPrice, fmtSignedUsd, pnlClass } from "./format";

const REASON_LABEL: Record<CloseReason, string> = {
  SL: "SL",
  TP: "TP",
  CATCH_UP_SL: "SL (rattrapage)",
  CATCH_UP_TP: "TP (rattrapage)",
};

export function AuditTab() {
  const trades = useAppStore((s) => s.closedTrades);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="card">
      <h2>Trades fermés ({trades.length})</h2>
      {trades.length === 0 && <div className="empty">Aucun trade fermé pour l'instant</div>}
      {[...trades].reverse().map((t) => {
        const expanded = openId === t.id;
        return (
          <div className="trade-row" key={t.id}>
            <div
              className="trade-head"
              onClick={() => setOpenId(expanded ? null : t.id)}
            >
              <div className="info">
                <span className={`side-badge ${t.side === "BUY" ? "buy" : "sell"}`}>
                  {t.side}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div>
                    {t.lots} lot · {fmtPrice(t.entryPrice)} → {fmtPrice(t.exitPrice)} ·{" "}
                    {REASON_LABEL[t.reason]}
                  </div>
                  <div className="meta">
                    {t.strategy} · {fmtDateTime(t.openTs)} ·{" "}
                    {fmtDuration(t.closeTs - t.openTs)}
                  </div>
                </div>
              </div>
              <span className={`pnl ${pnlClass(t.pnl)}`}>{fmtSignedUsd(t.pnl)}</span>
            </div>
            {expanded && (
              <div className="decision-logic">
                <div>
                  <b>Technique :</b> {t.logic.technical}
                </div>
                <div>
                  <b>Contexte :</b> {t.logic.context}
                </div>
                <div>
                  <b>Risque :</b> {t.logic.risk}
                </div>
                <div>
                  <b>Score qualité :</b> {t.logic.qualityScore}/100 ·{" "}
                  <b>Frais :</b> commission {t.commission.toFixed(2)} $, swap{" "}
                  {t.swap.toFixed(2)} $
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
