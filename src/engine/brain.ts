// StrategyBrain ICT : le prix est analysé en bougies (structure, liquidité,
// FVG/IFVG) et les entrées se prennent au contact d'une zone, avec confluence.
// Honnêteté du modèle : winProb plafonnée à 56%, l'edge vient du R:R.

import { getKillzone, type Killzone } from "./clock";
import { analyze, type IctAnalysis, type Sweep, type Zone } from "./ict";
import type {
  Bias,
  EngineState,
  SessionInfo,
  Signal,
  StrategyName,
  Tick,
} from "./types";

export type Rng = () => number;

export interface BrainResult {
  bias: Bias;
  killzone: Killzone | null;
  signal: Signal | null;
  /** Raison du rejet si un setup existait mais a été filtré. */
  rejection: string | null;
  /** Clé de la zone utilisée (anti-réentrée sur la même zone). */
  zoneKey: string | null;
}

export interface BrainOptions {
  /** Zones récemment tradées à ignorer (clés `kind-dir-createdT`). */
  recentZoneKeys?: readonly string[];
}

const MIN_M1 = 45; // bougies M1 minimum avant d'oser une analyse
const MIN_RR = 1.3;
const MAX_RR = 2.6;
const SWEEP_MAX_AGE_MS = 40 * 60_000; // un sweep n'est "récent" que 40 min

export function zoneKeyOf(z: Zone): string {
  return `${z.kind}-${z.dir}-${z.createdT}`;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Évalue l'état du marché et propose (ou rejette) une entrée ICT. */
export function evaluate(
  state: EngineState,
  tick: Tick,
  session: SessionInfo,
  opts: BrainOptions = {},
): BrainResult {
  const killzone = getKillzone(tick.ts);

  if (state.m1.length < MIN_M1) {
    return {
      bias: "NEUTRAL",
      killzone,
      signal: null,
      rejection: null, // pas un setup rejeté : simplement pas assez d'historique
      zoneKey: null,
    };
  }

  const a = analyze(state, tick.ts);
  const bias = a.biasM5;
  const P = tick.mid;
  const spread = tick.ask - tick.bid;

  // Zone active au contact du prix, la plus récente d'abord.
  const skip = new Set(opts.recentZoneKeys ?? []);
  const touched = [...a.zones]
    .reverse()
    .find((z) => P >= z.bottom && P <= z.top && !skip.has(zoneKeyOf(z)));

  if (!touched) {
    return { bias, killzone, signal: null, rejection: null, zoneKey: null };
  }

  const side = touched.dir === "BULL" ? "BUY" : "SELL";
  const zoneKey = zoneKeyOf(touched);

  // Sweep récent du côté opposé à l'entrée (raid des stops avant le retournement).
  const relevantSweep = findRelevantSweep(a, side, tick.ts);
  const mssAligned =
    a.mss !== null && a.mss.dir === (side === "BUY" ? "UP" : "DOWN");
  const isModel2022 = relevantSweep !== null && mssAligned;

  const strategy: StrategyName = isModel2022
    ? "Sweep+MSS"
    : touched.kind === "IFVG"
      ? "IFVG"
      : "FVG";

  // ---- SL : derrière la zone, et derrière l'extrême du sweep le cas échéant.
  const buffer = Math.max(0.25, a.atr1 * 0.25);
  let slPrice: number;
  if (side === "BUY") {
    slPrice = touched.bottom - buffer;
    if (relevantSweep) slPrice = Math.min(slPrice, relevantSweep.extreme - buffer);
  } else {
    slPrice = touched.top + buffer;
    if (relevantSweep) slPrice = Math.max(slPrice, relevantSweep.extreme + buffer);
  }
  const entryRef = side === "BUY" ? tick.ask : tick.bid;
  const slDistance = Math.abs(entryRef - slPrice);
  if (slDistance <= spread) {
    return {
      bias,
      killzone,
      signal: null,
      rejection: `Setup ${side} ${strategy} rejeté : SL trop proche (${slDistance.toFixed(2)} $ ≤ spread)`,
      zoneKey,
    };
  }

  // ---- Cible : prochaine liquidité opposée (draw on liquidity).
  const target = findTarget(a, side, entryRef);
  const rrRaw =
    target !== null ? Math.abs(target.price - entryRef) / slDistance : 0;
  if (target === null || rrRaw < MIN_RR) {
    return {
      bias,
      killzone,
      signal: null,
      rejection:
        `Setup ${side} ${strategy} rejeté : cible de liquidité trop proche ` +
        `(R:R ${rrRaw.toFixed(2)} < ${MIN_RR})`,
      zoneKey,
    };
  }
  const rr = clamp(rrRaw, MIN_RR, MAX_RR);

  // ---- Score de confluence.
  const inDiscount = P < a.range.equilibrium;
  const pdAligned = side === "BUY" ? inDiscount : !inDiscount;
  let score = 30;
  if (isModel2022) score += 25;
  else if (mssAligned) score += 12;
  if (bias === (side === "BUY" ? "BULLISH" : "BEARISH")) score += 10;
  if (killzone) score += 12;
  if (pdAligned) score += 8;
  if (touched.obAdjacent) score += 6;
  if (["PDH", "PDL", "EQH", "EQL"].includes(target.name)) score += 6;
  score = Math.min(100, score);

  // Hors kill zone, on durcit le filtre : l'ICT se trade aux heures qui bougent.
  const minQuality = session.minQuality + (killzone ? 0 : 12);
  if (score < minQuality) {
    return {
      bias,
      killzone,
      signal: null,
      rejection:
        `Setup ${side} ${strategy} rejeté : confluence ${score} < ${minQuality} ` +
        `(session ${session.name}${killzone ? `, ${killzone}` : ", hors kill zone"})`,
      zoneKey,
    };
  }

  const winProb = clamp(0.5 + (score / 100) * 0.06, 0.5, 0.56);

  const technical =
    `${strategy} ${side} sur ${touched.kind} ${touched.dir} ` +
    `[${touched.bottom.toFixed(2)}–${touched.top.toFixed(2)}]` +
    `${touched.obAdjacent ? " + order block adjacent" : ""}. ` +
    `Biais M5 ${bias}` +
    `${a.mss ? `, MSS ${a.mss.dir} @ ${a.mss.level.toFixed(2)}` : ""}` +
    `${relevantSweep ? `, sweep ${relevantSweep.level.name} @ ${relevantSweep.level.price.toFixed(2)} (extrême ${relevantSweep.extreme.toFixed(2)})` : ""}. ` +
    `Cible : ${target.name} @ ${target.price.toFixed(2)}. ATR M1 ${a.atr1.toFixed(2)} $.`;
  const context =
    `Session ${session.name}${killzone ? ` · ${killzone}` : " · hors kill zone"} · ` +
    `${pdAligned ? (inDiscount ? "discount" : "premium") + " aligné" : "équilibre défavorable"} ` +
    `(EQ ${a.range.equilibrium.toFixed(2)}) · spread ${spread.toFixed(2)} $ · ` +
    `seuil confluence ${minQuality}.`;

  const signal: Signal = {
    side,
    strategy,
    bias,
    winProb,
    rr,
    slDistance,
    qualityScore: score,
    ts: tick.ts,
    logic: { technical, context, risk: "", qualityScore: score },
  };

  return { bias, killzone, signal, rejection: null, zoneKey };
}

/** Sweep récent pertinent : raid des lows pour un BUY, des highs pour un SELL. */
function findRelevantSweep(
  a: IctAnalysis,
  side: "BUY" | "SELL",
  nowTs: number,
): Sweep | null {
  const wanted = side === "BUY" ? "LOW" : "HIGH";
  let best: Sweep | null = null;
  for (const s of a.sweeps) {
    if (s.level.side !== wanted) continue;
    if (nowTs - s.t > SWEEP_MAX_AGE_MS) continue;
    if (!best || s.t > best.t) best = s;
  }
  return best;
}

/** Prochaine liquidité du côté du trade (la cible que le prix va chercher). */
function findTarget(
  a: IctAnalysis,
  side: "BUY" | "SELL",
  entry: number,
): { name: string; price: number } | null {
  const spreadGuard = 0.2;
  let best: { name: string; price: number } | null = null;
  for (const l of a.levels) {
    if (side === "BUY" && l.side === "HIGH" && l.price > entry + spreadGuard) {
      if (!best || l.price < best.price) best = { name: l.name, price: l.price };
    }
    if (side === "SELL" && l.side === "LOW" && l.price < entry - spreadGuard) {
      if (!best || l.price > best.price) best = { name: l.name, price: l.price };
    }
  }
  if (!best) {
    // À défaut de pool identifié : borne du dealing range.
    const rangeTarget = side === "BUY" ? a.range.high : a.range.low;
    if (side === "BUY" && rangeTarget > entry + spreadGuard) {
      best = { name: "Range High", price: rangeTarget };
    } else if (side === "SELL" && rangeTarget < entry - spreadGuard) {
      best = { name: "Range Low", price: rangeTarget };
    }
  }
  return best;
}
