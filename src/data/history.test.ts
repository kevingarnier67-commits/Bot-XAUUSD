// Tests du backfill historique : parsing Twelve Data et fusion avec le local.

import { describe, expect, it } from "vitest";
import {
  mergeCandleHistory,
  mergeDayLevels,
  parseTwelveDataDays,
  parseTwelveDataSeries,
} from "./history";
import type { Candle } from "../engine/types";

describe("parseTwelveDataSeries", () => {
  it("convertit les valeurs (ordre décroissant, UTC) en bougies croissantes", () => {
    const candles = parseTwelveDataSeries({
      values: [
        { datetime: "2026-07-24 20:59:00", open: "4802.1", high: "4803.0", low: "4801.5", close: "4802.8" },
        { datetime: "2026-07-24 20:58:00", open: "4801.0", high: "4802.4", low: "4800.9", close: "4802.1" },
      ],
    });
    expect(candles).toHaveLength(2);
    expect(candles[0]!.t).toBeLessThan(candles[1]!.t);
    expect(candles[0]).toMatchObject({ o: 4801.0, h: 4802.4, l: 4800.9, c: 4802.1 });
    expect(new Date(candles[1]!.t).toISOString()).toBe("2026-07-24T20:59:00.000Z");
  });

  it("ignore les réponses en erreur ou les valeurs invalides", () => {
    expect(parseTwelveDataSeries({ status: "error" })).toHaveLength(0);
    expect(
      parseTwelveDataSeries({
        values: [{ datetime: "2026-07-24 20:59:00", open: "abc" }],
      }),
    ).toHaveLength(0);
  });
});

describe("parseTwelveDataDays", () => {
  it("exclut le jour courant (encore incomplet)", () => {
    const now = Date.UTC(2026, 6, 24, 12, 0, 0);
    const days = parseTwelveDataDays(
      {
        values: [
          { datetime: "2026-07-24", open: "4800", high: "4820", low: "4790", close: "4810" },
          { datetime: "2026-07-23", open: "4780", high: "4805", low: "4775", close: "4800" },
        ],
      },
      now,
    );
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: "2026-07-23", high: 4805, low: 4775 });
  });
});

describe("fusion avec l'état local", () => {
  const mk = (t: number, c: number): Candle => ({ t, o: c, h: c + 1, l: c - 1, c });

  it("les bougies locales priment sur les buckets identiques, tri croissant", () => {
    const local = [mk(120_000, 4801)];
    const fetched = [mk(60_000, 4800), mk(120_000, 9999), mk(180_000, 4802)];
    const merged = mergeCandleHistory(local, fetched);
    expect(merged.map((c) => c.t)).toEqual([60_000, 120_000, 180_000]);
    expect(merged[1]!.c).toBe(4801); // la bougie locale a gagné
  });

  it("mergeDayLevels exclut aujourd'hui et privilégie le local", () => {
    const now = Date.UTC(2026, 6, 24, 12, 0, 0);
    const merged = mergeDayLevels(
      [{ date: "2026-07-23", high: 4806, low: 4776 }],
      [
        { date: "2026-07-23", high: 9999, low: 1 },
        { date: "2026-07-22", high: 4790, low: 4760 },
        { date: "2026-07-24", high: 4820, low: 4790 }, // aujourd'hui → exclu
      ],
      now,
    );
    expect(merged.map((d) => d.date)).toEqual(["2026-07-22", "2026-07-23"]);
    expect(merged[1]!.high).toBe(4806);
  });
});
