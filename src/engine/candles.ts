// Agrégation des ticks réels en bougies M1/M5 et niveaux journaliers.
// Les concepts ICT (FVG, structure, liquidité) se lisent sur des bougies.

import { dayKeyUTC } from "./clock";
import type { Candle, DayLevel, EngineState, Tick } from "./types";

export const M1_MS = 60_000;
export const MAX_M1 = 1500; // ~25 h de M1 conservées (persistées)
export const MAX_DAYS = 15;

/** Intègre un tick dans la série M1 et le jour courant de l'état. */
export function updateCandles(state: EngineState, tick: Tick): void {
  const bucket = Math.floor(tick.ts / M1_MS) * M1_MS;
  const m1 = state.m1;
  const last = m1[m1.length - 1];

  if (!last || last.t !== bucket) {
    m1.push({ t: bucket, o: tick.mid, h: tick.mid, l: tick.mid, c: tick.mid });
    if (m1.length > MAX_M1) m1.splice(0, m1.length - MAX_M1);
  } else {
    if (tick.mid > last.h) last.h = tick.mid;
    if (tick.mid < last.l) last.l = tick.mid;
    last.c = tick.mid;
  }

  const date = dayKeyUTC(tick.ts);
  if (!state.curDay || state.curDay.date !== date) {
    if (state.curDay) {
      state.days.push(state.curDay);
      if (state.days.length > MAX_DAYS) {
        state.days.splice(0, state.days.length - MAX_DAYS);
      }
    }
    state.curDay = { date, high: tick.mid, low: tick.mid };
  } else {
    if (tick.mid > state.curDay.high) state.curDay.high = tick.mid;
    if (tick.mid < state.curDay.low) state.curDay.low = tick.mid;
  }
}

/** Agrège des M1 en bougies de `n` minutes (M5 pour la structure HTF). */
export function aggregate(m1: readonly Candle[], n: number): Candle[] {
  const out: Candle[] = [];
  const span = n * M1_MS;
  for (const c of m1) {
    const bucket = Math.floor(c.t / span) * span;
    const last = out[out.length - 1];
    if (!last || last.t !== bucket) {
      out.push({ t: bucket, o: c.o, h: c.h, l: c.l, c: c.c });
    } else {
      if (c.h > last.h) last.h = c.h;
      if (c.l < last.l) last.l = c.l;
      last.c = c.c;
    }
  }
  return out;
}

/** ATR classique (moyenne des true ranges) sur les `period` dernières bougies. */
export function atr(candles: readonly Candle[], period = 14, floor = 1.0): number {
  if (candles.length < 2) return floor;
  const start = Math.max(1, candles.length - period);
  let sum = 0;
  let n = 0;
  for (let i = start; i < candles.length; i++) {
    const cur = candles[i]!;
    const prevClose = candles[i - 1]!.c;
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prevClose),
      Math.abs(cur.l - prevClose),
    );
    sum += tr;
    n += 1;
  }
  return Math.max(floor, n > 0 ? sum / n : floor);
}

/** High/low des bougies M1 du jour UTC courant entre deux heures UTC [h0, h1). */
export function sessionRange(
  m1: readonly Candle[],
  nowTs: number,
  h0: number,
  h1: number,
): { high: number; low: number } | null {
  const dayStart = new Date(nowTs).setUTCHours(0, 0, 0, 0);
  const from = dayStart + h0 * 3_600_000;
  const to = dayStart + h1 * 3_600_000;
  let high = -Infinity;
  let low = Infinity;
  for (const c of m1) {
    if (c.t >= from && c.t < to) {
      if (c.h > high) high = c.h;
      if (c.l < low) low = c.l;
    }
  }
  if (high === -Infinity) return null;
  return { high, low };
}

/** Dernier jour clos ≠ aujourd'hui (source du PDH/PDL). */
export function previousDay(state: EngineState, nowTs: number): DayLevel | null {
  const today = dayKeyUTC(nowTs);
  for (let i = state.days.length - 1; i >= 0; i--) {
    const d = state.days[i]!;
    if (d.date !== today) return d;
  }
  return null;
}
