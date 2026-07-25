// Tests du StrategyBrain : régimes, honnêteté du winProb, filtre qualité.

import { describe, expect, it } from "vitest";
import { detectRegime, evaluate } from "./brain";
import { getSession } from "./clock";
import type { Tick } from "./types";

const T0 = Date.UTC(2026, 6, 22, 9, 0, 0);

function seq(mids: number[]): Tick[] {
  return mids.map((mid, i) => ({
    mid,
    bid: mid - 0.2,
    ask: mid + 0.2,
    ts: T0 + i * 10_000,
    source: "test",
  }));
}

describe("detectRegime", () => {
  it("détecte un TREND sur une pente régulière", () => {
    const mids = Array.from({ length: 30 }, (_, i) => 4800 + i * 0.15);
    expect(detectRegime(seq(mids))).toBe("TREND");
  });

  it("détecte un RANGE sur une oscillation plate", () => {
    const mids = Array.from({ length: 30 }, (_, i) => 4800 + Math.sin(i / 3) * 0.3);
    expect(detectRegime(seq(mids))).toBe("RANGE");
  });

  it("détecte VOLATILE sur de gros chocs alternés", () => {
    const mids = Array.from({ length: 30 }, (_, i) => 4800 + (i % 2 === 0 ? 3 : -3));
    expect(detectRegime(seq(mids))).toBe("VOLATILE");
  });
});

describe("evaluate — honnêteté et filtre qualité", () => {
  const session = getSession(T0);

  it("rejette si l'historique de ticks est insuffisant", () => {
    const r = evaluate(seq([4800, 4801]), session);
    expect(r.signal).toBeNull();
    expect(r.rejection).toMatch(/insuffisant/);
  });

  it("plafonne winProb à 56% et borne le R:R à 1.3–2.6", () => {
    const mids = Array.from({ length: 40 }, (_, i) => 4800 + i * 0.2);
    // rng haut → meilleur score possible ; le plafond doit tenir quand même.
    for (const rngVal of [0, 0.5, 0.999]) {
      const r = evaluate(seq(mids), session, () => rngVal);
      if (r.signal) {
        expect(r.signal.winProb).toBeLessThanOrEqual(0.56);
        expect(r.signal.winProb).toBeGreaterThanOrEqual(0.5);
        expect(r.signal.rr).toBeGreaterThanOrEqual(1.3);
        expect(r.signal.rr).toBeLessThanOrEqual(2.6);
      }
    }
  });

  it("rejette les signaux sous le seuil qualité de la session et fournit la raison", () => {
    // RANGE calme avec prix final au centre du range → setup faible ;
    // rng bas → bruit défavorable → score sous le seuil.
    const mids = Array.from({ length: 40 }, (_, i) => 4800 + Math.sin(i / 6) * 0.4);
    const r = evaluate(seq(mids), session, () => 0);
    expect(r.signal).toBeNull();
    expect(r.rejection).toMatch(/qualité/);
  });
});
