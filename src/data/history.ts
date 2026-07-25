// Récupération de l'historique via les APIs (quand une clé est disponible)
// pour éviter le démarrage à froid du moteur ICT :
// - Twelve Data `time_series` : bougies M1 réelles + jours (PDH/PDL) ;
// - GoldAPI.io date historique : high/low d'un jour passé (PDH/PDL seulement).
// gold-api.com (sans clé) n'expose pas d'historique → warm-up ~45 min.

import { MAX_DAYS, MAX_M1 } from "../engine/candles";
import { dayKeyUTC } from "../engine/clock";
import type { Candle, DayLevel } from "../engine/types";

// ---------- Parsing / fusion (purs, testables) ----------

interface TwelveDataValue {
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
}

interface TwelveDataSeries {
  values?: TwelveDataValue[];
  status?: string;
}

/** Convertit une réponse time_series (UTC, ordre décroissant) en bougies croissantes. */
export function parseTwelveDataSeries(json: TwelveDataSeries): Candle[] {
  if (json.status === "error" || !Array.isArray(json.values)) return [];
  const out: Candle[] = [];
  for (const v of json.values) {
    if (!v.datetime) continue;
    const ts = Date.parse(v.datetime.replace(" ", "T") + "Z");
    const o = Number(v.open);
    const h = Number(v.high);
    const l = Number(v.low);
    const c = Number(v.close);
    if (!Number.isFinite(ts) || !(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    out.push({ t: ts, o, h, l, c });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Réponse time_series 1day → niveaux journaliers (aujourd'hui exclu). */
export function parseTwelveDataDays(json: TwelveDataSeries, nowTs: number): DayLevel[] {
  const today = dayKeyUTC(nowTs);
  return parseTwelveDataSeries(json)
    .map((c) => ({ date: dayKeyUTC(c.t), high: c.h, low: c.l }))
    .filter((d) => d.date !== today);
}

/**
 * Fusionne l'historique récupéré avec les bougies locales.
 * Les bougies locales (ticks réellement vécus) priment sur les mêmes buckets.
 */
export function mergeCandleHistory(
  local: readonly Candle[],
  fetched: readonly Candle[],
): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of fetched) map.set(c.t, c);
  for (const c of local) map.set(c.t, c);
  return [...map.values()].sort((a, b) => a.t - b.t).slice(-MAX_M1);
}

export function mergeDayLevels(
  local: readonly DayLevel[],
  fetched: readonly DayLevel[],
  nowTs: number,
): DayLevel[] {
  const today = dayKeyUTC(nowTs);
  const map = new Map<string, DayLevel>();
  for (const d of fetched) map.set(d.date, d);
  for (const d of local) map.set(d.date, d);
  return [...map.values()]
    .filter((d) => d.date !== today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_DAYS);
}

// ---------- Appels réseau ----------

const TD_BASE = "https://api.twelvedata.com/time_series";

export interface FetchedHistory {
  m1: Candle[];
  days: DayLevel[];
}

/** Historique Twelve Data : ~400 M1 (6 h 30) + 6 derniers jours. 2 crédits API. */
export async function fetchTwelveDataHistory(apiKey: string): Promise<FetchedHistory> {
  const common = `symbol=XAU/USD&timezone=UTC&apikey=${encodeURIComponent(apiKey)}`;
  const [m1Res, dayRes] = await Promise.all([
    fetch(`${TD_BASE}?${common}&interval=1min&outputsize=400`),
    fetch(`${TD_BASE}?${common}&interval=1day&outputsize=6`),
  ]);
  if (!m1Res.ok || !dayRes.ok) {
    throw new Error(`HTTP ${m1Res.status}/${dayRes.status}`);
  }
  const now = Date.now();
  return {
    m1: parseTwelveDataSeries((await m1Res.json()) as TwelveDataSeries),
    days: parseTwelveDataDays((await dayRes.json()) as TwelveDataSeries, now),
  };
}

interface GoldApiIoHistorical {
  high_price?: number;
  low_price?: number;
}

/**
 * PDH/PDL via GoldAPI.io : remonte jusqu'à 4 jours en arrière pour trouver
 * le dernier jour coté (week-ends/fériés sans données).
 */
export async function fetchGoldApiIoPrevDay(
  apiKey: string,
  nowTs: number,
): Promise<DayLevel | null> {
  for (let back = 1; back <= 4; back++) {
    const d = new Date(nowTs - back * 24 * 3_600_000);
    const date = dayKeyUTC(d.getTime());
    const compact = date.replaceAll("-", "");
    const res = await fetch(`https://www.goldapi.io/api/XAU/USD/${compact}`, {
      headers: { "x-access-token": apiKey, "Content-Type": "application/json" },
    });
    if (!res.ok) continue;
    const data = (await res.json()) as GoldApiIoHistorical;
    if (
      typeof data.high_price === "number" &&
      typeof data.low_price === "number" &&
      data.high_price >= data.low_price &&
      data.low_price > 0
    ) {
      return { date, high: data.high_price, low: data.low_price };
    }
  }
  return null;
}
