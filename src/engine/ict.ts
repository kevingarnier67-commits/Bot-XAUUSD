// Analyse ICT pure sur bougies : structure de marché (BOS/MSS), Fair Value
// Gaps (FVG) et inversions (IFVG), order blocks adjacents, pools de liquidité
// (PDH/PDL, ranges de session, EQH/EQL), sweeps, premium/discount.

import { aggregate, atr, previousDay, sessionRange } from "./candles";
import type { Bias, Candle, EngineState } from "./types";

// ---------- Structure de marché ----------

export interface SwingPoint {
  i: number;
  t: number;
  price: number;
}

export interface Swings {
  highs: SwingPoint[];
  lows: SwingPoint[];
}

/** Points de bascule fractals : extrême entouré de k bougies de chaque côté. */
export function findSwings(candles: readonly Candle[], k = 2): Swings {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  for (let i = k; i < candles.length - k; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      const o = candles[j]!;
      if (o.h >= c.h) isHigh = false;
      if (o.l <= c.l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ i, t: c.t, price: c.h });
    if (isLow) lows.push({ i, t: c.t, price: c.l });
  }
  return { highs, lows };
}

/** Biais : HH+HL → BULLISH, LH+LL → BEARISH, sinon NEUTRAL. */
export function biasFromSwings(swings: Swings): Bias {
  const { highs, lows } = swings;
  if (highs.length < 2 || lows.length < 2) return "NEUTRAL";
  const hh = highs[highs.length - 1]!.price > highs[highs.length - 2]!.price;
  const hl = lows[lows.length - 1]!.price > lows[lows.length - 2]!.price;
  if (hh && hl) return "BULLISH";
  if (!hh && !hl) return "BEARISH";
  return "NEUTRAL";
}

export interface Mss {
  dir: "UP" | "DOWN";
  /** Index de la bougie de cassure. */
  i: number;
  t: number;
  /** Niveau de swing cassé. */
  level: number;
}

/**
 * Market Structure Shift : dernière clôture au-delà du dernier swing opposé.
 * MSS UP = clôture au-dessus du dernier swing high formé avant la cassure.
 */
export function detectMss(
  candles: readonly Candle[],
  swings: Swings,
  lookback = 30,
): Mss | null {
  const start = Math.max(0, candles.length - lookback);
  let best: Mss | null = null;
  for (let i = start; i < candles.length; i++) {
    const c = candles[i]!;
    const priorHigh = lastSwingBefore(swings.highs, i);
    const priorLow = lastSwingBefore(swings.lows, i);
    if (priorHigh && c.c > priorHigh.price) {
      if (!best || i > best.i) best = { dir: "UP", i, t: c.t, level: priorHigh.price };
    }
    if (priorLow && c.c < priorLow.price) {
      if (!best || i > best.i) best = { dir: "DOWN", i, t: c.t, level: priorLow.price };
    }
  }
  return best;
}

function lastSwingBefore(points: readonly SwingPoint[], i: number): SwingPoint | null {
  for (let j = points.length - 1; j >= 0; j--) {
    if (points[j]!.i < i) return points[j]!;
  }
  return null;
}

// ---------- FVG / IFVG ----------

export interface Zone {
  kind: "FVG" | "IFVG";
  /** BULL = zone support (on y achète), BEAR = zone résistance (on y vend). */
  dir: "BULL" | "BEAR";
  top: number;
  bottom: number;
  /** t de la bougie qui a créé le gap (clé anti-réentrée). */
  createdT: number;
  /** Order block adjacent (bougie opposée juste avant le displacement). */
  obAdjacent: boolean;
}

/**
 * Détecte les FVG à 3 bougies (imbalance) et suit leur état :
 * - ouvert tant que le prix n'a pas clôturé au travers ;
 * - clôture au-delà du bord opposé → inversion (IFVG, direction retournée) ;
 * - clôture revenant au travers d'un IFVG → zone morte (retirée).
 */
export function detectZones(candles: readonly Candle[], atr1: number): Zone[] {
  const zones: Zone[] = [];
  const minGap = Math.max(0.1, atr1 * 0.12);

  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2]!;
    const b = candles[i - 1]!;
    const c = candles[i]!;

    // FVG haussier : gap entre le high de A et le low de C, corps B haussier.
    // Order block : A est la dernière bougie baissière avant le displacement.
    if (c.l - a.h >= minGap && b.c > b.o) {
      zones.push({
        kind: "FVG",
        dir: "BULL",
        top: c.l,
        bottom: a.h,
        createdT: b.t,
        obAdjacent: a.c < a.o,
      });
    }
    // FVG baissier : gap entre le low de A et le high de C, corps B baissier.
    if (a.l - c.h >= minGap && b.c < b.o) {
      zones.push({
        kind: "FVG",
        dir: "BEAR",
        top: a.l,
        bottom: c.h,
        createdT: b.t,
        obAdjacent: a.c > a.o,
      });
    }
  }

  // Suivi d'état : on rejoue les clôtures postérieures à la création.
  const active: Zone[] = [];
  for (const z of zones) {
    let cur: Zone | null = z;
    for (const c of candles) {
      if (c.t <= z.createdT || !cur) continue;
      if (cur.kind === "FVG" && cur.dir === "BULL" && c.c < cur.bottom) {
        cur = { ...cur, kind: "IFVG", dir: "BEAR" }; // support percé → résistance
      } else if (cur.kind === "FVG" && cur.dir === "BEAR" && c.c > cur.top) {
        cur = { ...cur, kind: "IFVG", dir: "BULL" };
      } else if (cur.kind === "IFVG" && cur.dir === "BEAR" && c.c > cur.top) {
        cur = null; // inversion invalidée
      } else if (cur.kind === "IFVG" && cur.dir === "BULL" && c.c < cur.bottom) {
        cur = null;
      }
    }
    if (cur) active.push(cur);
  }

  return active.slice(-12);
}

// ---------- Liquidité ----------

export interface Level {
  name: string;
  price: number;
  side: "HIGH" | "LOW";
}

/** Pools de liquidité : PDH/PDL, range asiatique, range de Londres, EQH/EQL. */
export function liquidityLevels(
  state: EngineState,
  nowTs: number,
  swings: Swings,
  atr1: number,
): Level[] {
  const levels: Level[] = [];

  const pd = previousDay(state, nowTs);
  if (pd) {
    levels.push({ name: "PDH", price: pd.high, side: "HIGH" });
    levels.push({ name: "PDL", price: pd.low, side: "LOW" });
  }

  const hour = new Date(nowTs).getUTCHours();
  const asia = sessionRange(state.m1, nowTs, 0, 7);
  if (asia && hour >= 7) {
    levels.push({ name: "Asia High", price: asia.high, side: "HIGH" });
    levels.push({ name: "Asia Low", price: asia.low, side: "LOW" });
  }
  const london = sessionRange(state.m1, nowTs, 7, 12);
  if (london && hour >= 12) {
    levels.push({ name: "London High", price: london.high, side: "HIGH" });
    levels.push({ name: "London Low", price: london.low, side: "LOW" });
  }

  // Equal highs/lows : deux swings quasi égaux = pool de stops.
  const tol = Math.max(0.2, atr1 * 0.2);
  const eqh = findEqual(swings.highs, tol);
  if (eqh !== null) levels.push({ name: "EQH", price: eqh, side: "HIGH" });
  const eql = findEqual(swings.lows, tol);
  if (eql !== null) levels.push({ name: "EQL", price: eql, side: "LOW" });

  return levels;
}

function findEqual(points: readonly SwingPoint[], tol: number): number | null {
  for (let i = points.length - 1; i >= 1; i--) {
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      if (Math.abs(points[i]!.price - points[j]!.price) <= tol) {
        return Math.max(points[i]!.price, points[j]!.price);
      }
    }
  }
  return null;
}

export interface Sweep {
  level: Level;
  /** t de la bougie de raid. */
  t: number;
  /** Extrême atteint pendant le raid (pour placer le SL derrière). */
  extreme: number;
}

/**
 * Sweep de liquidité : mèche au-delà d'un niveau puis clôture de retour
 * en deçà — le raid a pris les stops sans que le niveau tienne.
 */
export function detectSweeps(
  candles: readonly Candle[],
  levels: readonly Level[],
  lookback = 45,
): Sweep[] {
  const start = Math.max(0, candles.length - lookback);
  const sweeps: Sweep[] = [];
  for (const level of levels) {
    for (let i = candles.length - 1; i >= start; i--) {
      const c = candles[i]!;
      if (level.side === "HIGH" && c.h > level.price && c.c < level.price) {
        sweeps.push({ level, t: c.t, extreme: c.h });
        break;
      }
      if (level.side === "LOW" && c.l < level.price && c.c > level.price) {
        sweeps.push({ level, t: c.t, extreme: c.l });
        break;
      }
    }
  }
  return sweeps;
}

// ---------- Premium / Discount ----------

export interface DealingRange {
  high: number;
  low: number;
  equilibrium: number;
}

export function dealingRange(candles: readonly Candle[], window = 120): DealingRange {
  const start = Math.max(0, candles.length - window);
  let high = -Infinity;
  let low = Infinity;
  for (let i = start; i < candles.length; i++) {
    const c = candles[i]!;
    if (c.h > high) high = c.h;
    if (c.l < low) low = c.l;
  }
  return { high, low, equilibrium: (high + low) / 2 };
}

// ---------- Analyse complète ----------

export interface IctAnalysis {
  biasM5: Bias;
  mss: Mss | null;
  zones: Zone[];
  levels: Level[];
  sweeps: Sweep[];
  range: DealingRange;
  atr1: number;
}

export function analyze(state: EngineState, nowTs: number): IctAnalysis {
  const m1 = state.m1;
  const atr1 = atr(m1, 14);
  const m5 = aggregate(m1, 5);
  const swingsM5 = findSwings(m5, 2);
  const swingsM1 = findSwings(m1, 2);
  const biasM5 = biasFromSwings(swingsM5);
  const mss = detectMss(m1, swingsM1);
  const zones = detectZones(m1.slice(-240), atr1);
  const levels = liquidityLevels(state, nowTs, swingsM1, atr1);
  const sweeps = detectSweeps(m1, levels);
  return { biasM5, mss, zones, levels, sweeps, range: dealingRange(m1), atr1 };
}
