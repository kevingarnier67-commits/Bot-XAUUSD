// KPIs calculés sur l'historique des trades fermés et la courbe d'équité.

import type { ClosedTrade, EquityPoint } from "./types";

export interface Kpis {
  totalPnl: number;
  winRate: number; // 0–1, NaN si aucun trade
  profitFactor: number; // Infinity possible si aucune perte
  expectancy: number; // $ moyen par trade
  maxDrawdown: number; // fraction 0–1
  totalFees: number; // commissions + swaps (valeur positive = coût)
  tradeCount: number;
}

export function computeKpis(
  trades: readonly ClosedTrade[],
  equityCurve: readonly EquityPoint[],
): Kpis {
  let grossWin = 0;
  let grossLoss = 0;
  let wins = 0;
  let totalPnl = 0;
  let totalFees = 0;

  for (const t of trades) {
    totalPnl += t.pnl;
    totalFees += t.commission - t.swap; // swap est négatif → coût positif
    if (t.pnl >= 0) {
      wins += 1;
      grossWin += t.pnl;
    } else {
      grossLoss += -t.pnl;
    }
  }

  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    if (peak > 0) {
      const dd = 1 - p.equity / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

  const n = trades.length;
  return {
    totalPnl,
    winRate: n > 0 ? wins / n : NaN,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : NaN,
    expectancy: n > 0 ? totalPnl / n : NaN,
    maxDrawdown,
    totalFees,
    tradeCount: n,
  };
}
