// StrategyBrain : détection de régime sur les ticks réels + génération de signaux.
// Honnêteté du modèle : winProb plafonnée à 56%, l'edge vient du R:R.

import { atrFromTicks, highLow, realizedVol, slopePerMinute } from "./indicators";
import type {
  Regime,
  SessionInfo,
  Signal,
  StrategyName,
  Tick,
} from "./types";

export type Rng = () => number;

export interface BrainResult {
  regime: Regime;
  signal: Signal | null;
  /** Raison du rejet si aucun signal accepté (pour le log). */
  rejection: string | null;
}

/** Seuils de classification du régime (fractions du prix / $ par minute). */
const VOL_HIGH = 2.2e-4; // vol tick-à-tick élevée → VOLATILE
const SLOPE_TREND = 0.35; // |pente| $/min significative → TREND

export function detectRegime(ticks: readonly Tick[]): Regime {
  const vol = realizedVol(ticks);
  const slope = Math.abs(slopePerMinute(ticks));
  if (vol > VOL_HIGH) return "VOLATILE";
  if (slope > SLOPE_TREND) return "TREND";
  return "RANGE";
}

const STRATEGY_FOR_REGIME: Record<Regime, StrategyName> = {
  TREND: "Momentum",
  RANGE: "MeanReversion",
  VOLATILE: "Breakout",
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Évalue la fenêtre de ticks et propose (ou rejette) un signal.
 * `rng` est injectable pour rendre les tests déterministes.
 */
export function evaluate(
  ticks: readonly Tick[],
  session: SessionInfo,
  rng: Rng = Math.random,
): BrainResult {
  if (ticks.length < 12) {
    return {
      regime: "RANGE",
      signal: null,
      rejection: "Historique de ticks insuffisant pour analyser",
    };
  }

  const regime = detectRegime(ticks);
  const strategy = STRATEGY_FOR_REGIME[regime];
  const last = ticks[ticks.length - 1]!;
  const slope = slopePerMinute(ticks);
  const vol = realizedVol(ticks);
  const atr = atrFromTicks(ticks);
  const { high, low } = highLow(ticks);
  const mid = last.mid;
  const spread = last.ask - last.bid;

  let side: Signal["side"];
  let setupStrength: number; // 0–1, force du setup selon la stratégie

  if (strategy === "Momentum") {
    side = slope > 0 ? "BUY" : "SELL";
    setupStrength = clamp(Math.abs(slope) / (SLOPE_TREND * 3), 0, 1);
  } else if (strategy === "MeanReversion") {
    const center = (high + low) / 2;
    const span = Math.max(high - low, 0.01);
    const offset = (mid - center) / (span / 2); // -1 (bas du range) … +1 (haut)
    side = offset > 0 ? "SELL" : "BUY";
    setupStrength = clamp(Math.abs(offset), 0, 1);
  } else {
    // Breakout : on suit la cassure du bord de fenêtre le plus proche.
    const distHigh = high - mid;
    const distLow = mid - low;
    side = distHigh < distLow ? "BUY" : "SELL";
    const proximity = 1 - clamp(Math.min(distHigh, distLow) / Math.max(atr, 0.01), 0, 1);
    setupStrength = clamp(proximity * (vol / VOL_HIGH) * 0.6, 0, 1);
  }

  // Score qualité : force du setup, pénalité de spread, bruit d'incertitude.
  const spreadPenalty = clamp((spread / Math.max(atr, 0.01)) * 18, 0, 25);
  const noise = (rng() - 0.5) * 14;
  const qualityScore = Math.round(
    clamp(35 + setupStrength * 55 - spreadPenalty + noise, 0, 100),
  );

  // winProb honnête : 50–56% max, corrélée à la qualité.
  const winProb = clamp(0.5 + (qualityScore / 100) * 0.06, 0.5, 0.56);
  // R:R 1.3–2.6 : les setups tendance/breakout visent plus loin.
  const rrBase = strategy === "MeanReversion" ? 1.3 : 1.7;
  const rr = clamp(rrBase + setupStrength * 0.9, 1.3, 2.6);

  const slDistance = atr;

  const logicTechnical =
    `Régime ${regime} → ${strategy}. Pente ${slope.toFixed(2)} $/min, ` +
    `vol réalisée ${(vol * 100).toFixed(3)}%/tick, ATR ${atr.toFixed(2)} $, ` +
    `fenêtre ${low.toFixed(2)}–${high.toFixed(2)} $.`;
  const logicContext =
    `Session ${session.name} (vol ×${session.volFactor}), ` +
    `spread ${spread.toFixed(2)} $, seuil qualité ${session.minQuality}.`;

  if (qualityScore < session.minQuality) {
    return {
      regime,
      signal: null,
      rejection:
        `Signal ${side} ${strategy} rejeté : qualité ${qualityScore} < ` +
        `${session.minQuality} (session ${session.name})`,
    };
  }

  const signal: Signal = {
    side,
    strategy,
    regime,
    winProb,
    rr,
    slDistance,
    qualityScore,
    ts: last.ts,
    logic: {
      technical: logicTechnical,
      context: logicContext,
      risk: "", // complété par le RiskManager au sizing
      qualityScore,
    },
  };

  return { regime, signal, rejection: null };
}
