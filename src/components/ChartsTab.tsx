// Onglet CHARTS : equity curve + KPIs.

import { useAppStore } from "../state/store";
import { fmtSignedUsd, fmtUsd, pnlClass } from "./format";
import { EquityChart } from "./EquityChart";

export function ChartsTab() {
  const equityCurve = useAppStore((s) => s.equityCurve);
  const initialCapital = useAppStore((s) => s.initialCapital);
  const kpis = useAppStore((s) => s.kpis);

  const pf =
    kpis && Number.isFinite(kpis.profitFactor)
      ? kpis.profitFactor.toFixed(2)
      : kpis && kpis.profitFactor === Infinity
        ? "∞"
        : "—";

  return (
    <>
      <div className="card">
        <h2>Equity curve</h2>
        <EquityChart curve={equityCurve} initialCapital={initialCapital} />
      </div>

      <div className="card">
        <h2>KPIs</h2>
        <div className="kpi-grid">
          <div className="kpi">
            <div className={`v ${kpis ? pnlClass(kpis.totalPnl) : ""}`}>
              {kpis ? fmtSignedUsd(kpis.totalPnl) : "—"}
            </div>
            <div className="l">P&amp;L</div>
          </div>
          <div className="kpi">
            <div className="v gold">
              {kpis && !Number.isNaN(kpis.winRate)
                ? `${(kpis.winRate * 100).toFixed(1)}%`
                : "—"}
            </div>
            <div className="l">Win rate</div>
          </div>
          <div className="kpi">
            <div className="v gold">{pf}</div>
            <div className="l">Profit factor</div>
          </div>
          <div className="kpi">
            <div className={`v ${kpis && !Number.isNaN(kpis.expectancy) ? pnlClass(kpis.expectancy) : ""}`}>
              {kpis && !Number.isNaN(kpis.expectancy)
                ? fmtSignedUsd(kpis.expectancy)
                : "—"}
            </div>
            <div className="l">Expectancy</div>
          </div>
          <div className="kpi">
            <div className="v neg">
              {kpis ? `${(kpis.maxDrawdown * 100).toFixed(2)}%` : "—"}
            </div>
            <div className="l">Max DD</div>
          </div>
          <div className="kpi">
            <div className="v">{kpis ? fmtUsd(kpis.totalFees) : "—"}</div>
            <div className="l">Frais</div>
          </div>
        </div>
        <div className="empty" style={{ paddingBottom: 0 }}>
          {kpis?.tradeCount ?? 0} trade(s) fermé(s)
        </div>
      </div>
    </>
  );
}
