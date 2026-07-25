// Tests de l'Executor : SL/TP sur ticks synthétiques, cooldown, daily halt,
// reset au jour suivant, rattrapage post-suspension.

import { describe, expect, it } from "vitest";
import { Executor, initialEngineState } from "./executor";
import { getSession } from "./clock";
import type { SessionInfo, Signal, Tick } from "./types";

// Mercredi 22/07/2026 09:00 UTC — marché ouvert, session London.
const T0 = Date.UTC(2026, 6, 22, 9, 0, 0);
const SESSION: SessionInfo = getSession(T0);

function mkTick(mid: number, ts: number, spread = 0.4): Tick {
  return {
    mid,
    bid: mid - spread / 2,
    ask: mid + spread / 2,
    ts,
    source: "test",
  };
}

function mkSignal(side: Signal["side"], slDistance = 5, rr = 2): Signal {
  return {
    side,
    strategy: "FVG",
    bias: "BULLISH",
    winProb: 0.54,
    rr,
    slDistance,
    qualityScore: 70,
    ts: T0,
    logic: { technical: "t", context: "c", risk: "", qualityScore: 70 },
  };
}

/** rng à zéro → slippage nul, exécution déterministe. */
const zeroRng = () => 0;

function newExecutor(capital = 10_000): Executor {
  return new Executor(initialEngineState(capital, T0), zeroRng);
}

describe("SL/TP sur séquence de ticks synthétiques", () => {
  it("clôture un BUY au toucher du SL", () => {
    const ex = newExecutor();
    const entry = mkTick(2000, T0);
    const { opened } = ex.tryOpen(mkSignal("BUY"), entry, SESSION);
    expect(opened).not.toBeNull();
    // Entrée à l'ask 2000.2 → SL 1995.2, TP 2010.2.
    expect(opened!.entryPrice).toBeCloseTo(2000.2, 10);
    expect(opened!.sl).toBeCloseTo(1995.2, 10);

    // Ticks qui descendent sans toucher, puis toucher du SL par le bid.
    expect(ex.onTick(mkTick(1997, T0 + 10_000))).toHaveLength(0);
    const closed = ex.onTick(mkTick(1995.2, T0 + 20_000)); // bid 1995.0 ≤ SL
    expect(closed).toHaveLength(1);
    expect(closed[0]!.reason).toBe("SL");
    expect(closed[0]!.exitPrice).toBeCloseTo(1995.2, 10);
    expect(closed[0]!.pnl).toBeLessThan(0);
    expect(ex.state.positions).toHaveLength(0);
  });

  it("clôture un SELL au toucher du TP", () => {
    const ex = newExecutor();
    const entry = mkTick(2000, T0);
    const { opened } = ex.tryOpen(mkSignal("SELL", 5, 2), entry, SESSION);
    // Entrée au bid 1999.8 → TP à 1999.8 − 10 = 1989.8 (côté ask).
    expect(opened!.tp).toBeCloseTo(1989.8, 10);

    const closed = ex.onTick(mkTick(1989.4, T0 + 10_000)); // ask 1989.6 ≤ TP
    expect(closed).toHaveLength(1);
    expect(closed[0]!.reason).toBe("TP");
    expect(closed[0]!.pnl).toBeGreaterThan(0);
  });
});

describe("cooldown après 3 pertes consécutives", () => {
  it("active un cooldown de 45 min et rejette les nouvelles entrées", () => {
    const ex = newExecutor();
    let now = T0;
    for (let i = 0; i < 3; i++) {
      const { opened } = ex.tryOpen(mkSignal("BUY"), mkTick(2000, now), SESSION);
      expect(opened).not.toBeNull();
      now += 10_000;
      const closed = ex.onTick(mkTick(1994, now)); // SL touché
      expect(closed).toHaveLength(1);
      now += 10_000;
    }
    expect(ex.state.consecutiveLosses).toBe(3);
    expect(ex.state.cooldownUntil).toBeGreaterThan(now);

    const res = ex.tryOpen(mkSignal("BUY"), mkTick(2000, now), SESSION);
    expect(res.opened).toBeNull();
    expect(res.rejection).toMatch(/Cooldown/);
    expect(ex.status(now, true)).toBe("COOLDOWN");

    // Après 45 min, le cooldown est levé.
    const after = ex.state.cooldownUntil + 1;
    expect(ex.status(after, true)).toBe("RUNNING");
  });
});

describe("daily loss limit -3% et reset au jour suivant", () => {
  it("passe HALTED sous -3% et rejette toute entrée", () => {
    const ex = newExecutor(10_000);
    // Simule une journée déjà dans le rouge : balance proche du seuil.
    ex.state.balance = 9_750;

    const { opened } = ex.tryOpen(mkSignal("BUY"), mkTick(2000, T0), SESSION);
    expect(opened).not.toBeNull();
    const closed = ex.onTick(mkTick(1994, T0 + 10_000)); // perte ~1% → sous 9 700
    expect(closed).toHaveLength(1);
    expect(ex.state.balance).toBeLessThan(9_700);
    expect(ex.state.haltedForDay).toBe(ex.state.dayKey);
    expect(ex.status(T0 + 20_000, true)).toBe("HALTED");

    const res = ex.tryOpen(mkSignal("BUY"), mkTick(2000, T0 + 20_000), SESSION);
    expect(res.opened).toBeNull();
    expect(res.rejection).toMatch(/HALTED|Daily/);
  });

  it("lève le halt au passage du jour UTC suivant", () => {
    const ex = newExecutor(10_000);
    ex.state.balance = 9_600;
    ex.state.haltedForDay = ex.state.dayKey;

    const nextDay = T0 + 24 * 3_600_000;
    ex.onTick(mkTick(2000, nextDay));
    expect(ex.state.haltedForDay).toBe("");
    expect(ex.status(nextDay, true)).toBe("RUNNING");
    // La référence de perte quotidienne repart de l'équité courante.
    expect(ex.state.dayStartEquity).toBeCloseTo(9_600, 0);
    const res = ex.tryOpen(mkSignal("BUY"), mkTick(2000, nextDay + 1000), SESSION);
    expect(res.opened).not.toBeNull();
  });
});

describe("rattrapage post-suspension", () => {
  it("clôture au SL en utilisant le low de la période manquée", () => {
    const ex = newExecutor();
    const { opened } = ex.tryOpen(mkSignal("BUY"), mkTick(2000, T0), SESSION);
    expect(opened!.sl).toBeCloseTo(1995.2, 10);

    // 30 min plus tard, le prix est revenu à 2001 MAIS le low manqué a percé le SL.
    const resume = mkTick(2001, T0 + 30 * 60_000);
    const closed = ex.catchUp(resume, { high: 2003, low: 1994 }, 30 * 60_000);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.reason).toBe("CATCH_UP_SL");
    expect(closed[0]!.exitPrice).toBeCloseTo(1995.2, 10);
    expect(ex.state.logs.some((l) => l.kind === "catch_up")).toBe(true);
  });

  it("clôture au TP quand le high manqué l'a atteint", () => {
    const ex = newExecutor();
    const { opened } = ex.tryOpen(mkSignal("BUY", 5, 2), mkTick(2000, T0), SESSION);
    expect(opened!.tp).toBeCloseTo(2010.2, 10);

    const resume = mkTick(2005, T0 + 30 * 60_000);
    const closed = ex.catchUp(resume, { high: 2012, low: 1999 }, 30 * 60_000);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.reason).toBe("CATCH_UP_TP");
    expect(closed[0]!.pnl).toBeGreaterThan(0);
  });

  it("sans high/low fourni, utilise le prix courant uniquement", () => {
    const ex = newExecutor();
    ex.tryOpen(mkSignal("BUY"), mkTick(2000, T0), SESSION);

    // Prix courant entre SL et TP → position conservée, rattrapage loggé.
    const resume = mkTick(2001, T0 + 15 * 60_000);
    const closed = ex.catchUp(resume, null, 15 * 60_000);
    expect(closed).toHaveLength(0);
    expect(ex.state.positions).toHaveLength(1);
    expect(ex.state.logs.some((l) => l.kind === "catch_up")).toBe(true);
  });

  it("cas pire : SL et TP tous deux dans le range manqué → SL prioritaire", () => {
    const ex = newExecutor();
    ex.tryOpen(mkSignal("BUY", 5, 2), mkTick(2000, T0), SESSION);

    const resume = mkTick(2000, T0 + 60 * 60_000);
    const closed = ex.catchUp(resume, { high: 2015, low: 1990 }, 60 * 60_000);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.reason).toBe("CATCH_UP_SL");
  });
});

describe("frais", () => {
  it("débite commission et swap dans le PnL", () => {
    const ex = newExecutor();
    const { opened } = ex.tryOpen(mkSignal("BUY", 5, 2), mkTick(2000, T0), SESSION);
    const lots = opened!.lots;

    // TP touché 2 h plus tard : swap 2 h accru.
    const closed = ex.onTick(mkTick(2011, T0 + 2 * 3_600_000));
    expect(closed).toHaveLength(1);
    const t = closed[0]!;
    expect(t.commission).toBeCloseTo(3.5 * lots, 10);
    expect(t.swap).toBeCloseTo(-0.45 * lots * 2, 6);
    const gross = (t.exitPrice - t.entryPrice) * lots * 100;
    expect(t.pnl).toBeCloseTo(gross - t.commission + t.swap, 6);
  });
});
