// Tests des primitives ICT : FVG/IFVG, sweeps, structure, bougies.

import { describe, expect, it } from "vitest";
import { aggregate, atr, updateCandles } from "./candles";
import { initialEngineState } from "./executor";
import {
  biasFromSwings,
  detectMss,
  detectSweeps,
  detectZones,
  findSwings,
} from "./ict";
import type { Candle, Tick } from "./types";

const T0 = Date.UTC(2026, 6, 22, 8, 0, 0);

function mkCandle(i: number, o: number, h: number, l: number, c: number): Candle {
  return { t: T0 + i * 60_000, o, h, l, c };
}

/** Série plate servant de bourrage avant un motif. */
function flat(count: number, price: number, startI = 0): Candle[] {
  return Array.from({ length: count }, (_, k) =>
    mkCandle(startI + k, price, price + 0.05, price - 0.05, price),
  );
}

describe("candles — agrégation depuis les ticks", () => {
  it("groupe les ticks en M1 et suit le high/low du jour", () => {
    const state = initialEngineState(10_000, T0);
    const ticks: Tick[] = [
      { mid: 4800, bid: 4799.8, ask: 4800.2, ts: T0, source: "t" },
      { mid: 4802, bid: 4801.8, ask: 4802.2, ts: T0 + 20_000, source: "t" },
      { mid: 4799, bid: 4798.8, ask: 4799.2, ts: T0 + 40_000, source: "t" },
      { mid: 4801, bid: 4800.8, ask: 4801.2, ts: T0 + 70_000, source: "t" },
    ];
    for (const t of ticks) updateCandles(state, t);

    expect(state.m1).toHaveLength(2);
    expect(state.m1[0]).toMatchObject({ o: 4800, h: 4802, l: 4799, c: 4799 });
    expect(state.m1[1]).toMatchObject({ o: 4801, c: 4801 });
    expect(state.curDay).toMatchObject({ high: 4802, low: 4799 });
  });

  it("clôt le jour UTC dans days au passage de minuit (PDH/PDL)", () => {
    const state = initialEngineState(10_000, T0);
    updateCandles(state, { mid: 4800, bid: 0, ask: 0, ts: T0, source: "t" });
    updateCandles(state, { mid: 4810, bid: 0, ask: 0, ts: T0 + 3_600_000, source: "t" });
    const nextDay = T0 + 24 * 3_600_000;
    updateCandles(state, { mid: 4805, bid: 0, ask: 0, ts: nextDay, source: "t" });

    expect(state.days).toHaveLength(1);
    expect(state.days[0]).toMatchObject({ high: 4810, low: 4800 });
    expect(state.curDay?.high).toBe(4805);
  });

  it("agrège les M1 en M5", () => {
    const m1 = Array.from({ length: 10 }, (_, i) =>
      mkCandle(i, 4800 + i, 4801 + i, 4799 + i, 4800.5 + i),
    );
    const m5 = aggregate(m1, 5);
    expect(m5).toHaveLength(2);
    expect(m5[0]!.o).toBe(4800);
    expect(m5[0]!.h).toBe(4805); // high de la 5e M1
    expect(m5[0]!.c).toBe(4804.5);
  });

  it("atr respecte le plancher", () => {
    expect(atr([], 14, 1)).toBe(1);
    expect(atr(flat(20, 4800), 14, 1)).toBe(1);
  });
});

describe("FVG / IFVG", () => {
  it("détecte un FVG haussier avec order block adjacent", () => {
    const candles = [
      ...flat(5, 4800),
      mkCandle(5, 4800.2, 4800.5, 4799.5, 4799.8), // A baissière (order block)
      mkCandle(6, 4799.8, 4804.5, 4799.7, 4804.2), // B displacement haussier
      mkCandle(7, 4804.2, 4805.5, 4803.0, 4805.0), // C : low 4803 > high A 4800.5
    ];
    const zones = detectZones(candles, 1);
    const fvg = zones.find((z) => z.dir === "BULL");
    expect(fvg).toBeDefined();
    expect(fvg!.kind).toBe("FVG");
    expect(fvg!.bottom).toBeCloseTo(4800.5, 10);
    expect(fvg!.top).toBeCloseTo(4803.0, 10);
    expect(fvg!.obAdjacent).toBe(true);
  });

  it("inverse un FVG percé en IFVG (support → résistance)", () => {
    const candles = [
      ...flat(5, 4800),
      mkCandle(5, 4800.2, 4800.5, 4799.5, 4799.8),
      mkCandle(6, 4799.8, 4804.5, 4799.7, 4804.2),
      mkCandle(7, 4804.2, 4805.5, 4803.0, 4805.0),
      // Clôture sous le bas de la zone [4800.5–4803] → inversion.
      mkCandle(8, 4805.0, 4805.2, 4799.0, 4799.5),
    ];
    const zones = detectZones(candles, 1);
    const ifvg = zones.find((z) => z.kind === "IFVG");
    expect(ifvg).toBeDefined();
    expect(ifvg!.dir).toBe("BEAR"); // on y vend désormais le retest
    expect(ifvg!.bottom).toBeCloseTo(4800.5, 10);
  });

  it("supprime un IFVG invalidé par une clôture de retour", () => {
    const candles = [
      ...flat(5, 4800),
      mkCandle(5, 4800.2, 4800.5, 4799.5, 4799.8),
      mkCandle(6, 4799.8, 4804.5, 4799.7, 4804.2),
      mkCandle(7, 4804.2, 4805.5, 4803.0, 4805.0),
      mkCandle(8, 4805.0, 4805.2, 4799.0, 4799.5), // inversion
      mkCandle(9, 4799.5, 4804.8, 4799.4, 4804.5), // clôture au-dessus du top → morte
    ];
    const zones = detectZones(candles, 1);
    expect(zones.find((z) => z.kind === "IFVG")).toBeUndefined();
  });
});

describe("liquidité et sweeps", () => {
  it("détecte le sweep d'un low (mèche sous le niveau, clôture au-dessus)", () => {
    const candles = [
      ...flat(10, 4800),
      // Raid : mèche à 4794.5 sous le PDL 4795, clôture de retour à 4800.8.
      mkCandle(10, 4800, 4801, 4794.5, 4800.8),
      mkCandle(11, 4800.8, 4802, 4800.2, 4801.5),
    ];
    const sweeps = detectSweeps(candles, [
      { name: "PDL", price: 4795, side: "LOW" },
    ]);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]!.extreme).toBeCloseTo(4794.5, 10);
  });

  it("ignore un niveau cassé franchement (clôture au-delà = pas un sweep)", () => {
    const candles = [
      ...flat(10, 4800),
      mkCandle(10, 4800, 4801, 4793, 4793.5), // clôture SOUS le niveau
    ];
    const sweeps = detectSweeps(candles, [
      { name: "PDL", price: 4795, side: "LOW" },
    ]);
    expect(sweeps).toHaveLength(0);
  });
});

describe("structure de marché", () => {
  /** Zigzag : contrôle précis des swings. */
  function zigzag(levels: number[]): Candle[] {
    return levels.map((p, i) => mkCandle(i, p, p + 0.2, p - 0.2, p));
  }

  it("biais haussier sur HH + HL", () => {
    const candles = zigzag([
      4800, 4803, 4806, 4803, 4801, 4804, 4809, 4805, 4803, 4807, 4812, 4808, 4806, 4809,
    ]);
    const swings = findSwings(candles, 2);
    expect(biasFromSwings(swings)).toBe("BULLISH");
  });

  it("biais baissier sur LH + LL", () => {
    const candles = zigzag([
      4812, 4809, 4806, 4809, 4811, 4807, 4802, 4806, 4808, 4804, 4798, 4802, 4804, 4800,
    ]);
    const swings = findSwings(candles, 2);
    expect(biasFromSwings(swings)).toBe("BEARISH");
  });

  it("détecte un MSS UP : clôture au-dessus du dernier swing high", () => {
    const candles = zigzag([
      4808, 4805, 4802, 4805, 4807, 4804, 4800, 4803, 4805, 4802, 4799, 4801,
    ]).concat([mkCandle(12, 4801, 4808.5, 4800.8, 4808.2)]); // cassure au-dessus de 4807.2
    const swings = findSwings(candles, 2);
    const mss = detectMss(candles, swings);
    expect(mss).not.toBeNull();
    expect(mss!.dir).toBe("UP");
  });
});
