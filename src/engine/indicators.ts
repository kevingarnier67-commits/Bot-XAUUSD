// Indicateurs calculés sur les ticks réels reçus (fenêtres glissantes).

import type { Tick } from "./types";

/** Pente par régression linéaire simple, en $/minute, sur les mids. */
export function slopePerMinute(ticks: readonly Tick[]): number {
  const n = ticks.length;
  if (n < 2) return 0;
  const t0 = ticks[0]!.ts;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const t of ticks) {
    const x = (t.ts - t0) / 60_000; // minutes
    const y = t.mid;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/** Volatilité réalisée : écart-type des rendements tick-à-tick, en fraction du prix. */
export function realizedVol(ticks: readonly Tick[]): number {
  const n = ticks.length;
  if (n < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    const prev = ticks[i - 1]!.mid;
    if (prev > 0) rets.push(ticks[i]!.mid / prev - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rets.length;
  return Math.sqrt(variance);
}

/**
 * ATR approximé sur ticks : moyenne des amplitudes absolues tick-à-tick,
 * remise à l'échelle d'un "range" utilisable pour les distances SL ($).
 * Plancher pour éviter des SL collés au prix quand le flux est calme.
 */
export function atrFromTicks(ticks: readonly Tick[], floor = 1.5): number {
  const n = ticks.length;
  if (n < 2) return floor;
  let sum = 0;
  for (let i = 1; i < n; i++) {
    sum += Math.abs(ticks[i]!.mid - ticks[i - 1]!.mid);
  }
  const avgMove = sum / (n - 1);
  // Un SL raisonnable couvre plusieurs mouvements moyens consécutifs.
  return Math.max(floor, avgMove * 12);
}

/** Plus haut / plus bas des mids de la fenêtre. */
export function highLow(ticks: readonly Tick[]): { high: number; low: number } {
  let high = -Infinity;
  let low = Infinity;
  for (const t of ticks) {
    if (t.mid > high) high = t.mid;
    if (t.mid < low) low = t.mid;
  }
  return { high, low };
}
