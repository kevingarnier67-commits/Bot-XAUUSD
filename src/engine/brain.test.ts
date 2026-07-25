// Tests du StrategyBrain ICT : scénario complet d'entrée sur FVG,
// filtres kill zone / R:R, honnêteté du winProb, anti-réentrée.

import { describe, expect, it } from "vitest";
import { evaluate } from "./brain";
import { getSession } from "./clock";
import { initialEngineState } from "./executor";
import type { Candle, EngineState, Tick } from "./types";

// Mercredi 22/07/2026 — les M1 démarrent à 06:30 UTC, l'entrée a lieu ~08:35
// (session LONDON, kill zone London 07–10).
const START = Date.UTC(2026, 6, 22, 6, 30, 0);

function mkTick(mid: number, ts: number): Tick {
  return { mid, bid: mid - 0.2, ask: mid + 0.2, ts, source: "test" };
}

/**
 * Construit un état complet : tendance haussière en zigzag (biais M5 BULLISH),
 * puis displacement créant un FVG haussier, puis pullback dans la zone.
 */
function buildBullishScenario(): { state: EngineState; tick: Tick; X: number } {
  const state = initialEngineState(10_000, START);
  const m1: Candle[] = [];

  // 120 M1 : montée en vagues (période 30 min) → HH/HL sur M5.
  for (let i = 0; i < 120; i++) {
    const base = 4790 + i * 0.15;
    const wave = 4 * Math.sin((2 * Math.PI * i) / 30);
    const mid = base + wave;
    m1.push({
      t: START + i * 60_000,
      o: mid - 0.05,
      h: mid + 0.35,
      l: mid - 0.35,
      c: mid + 0.05,
    });
  }
  const X = m1[119]!.c;

  // Order block (baissière), displacement, continuation → FVG [X+0.3, X+3.4].
  m1.push({ t: START + 120 * 60_000, o: X + 0.1, h: X + 0.3, l: X - 0.3, c: X - 0.2 });
  m1.push({ t: START + 121 * 60_000, o: X - 0.2, h: X + 4.2, l: X - 0.25, c: X + 4 });
  m1.push({ t: START + 122 * 60_000, o: X + 4, h: X + 4.8, l: X + 3.4, c: X + 4.5 });
  // Pullback vers la zone.
  m1.push({ t: START + 123 * 60_000, o: X + 4.4, h: X + 4.5, l: X + 2.2, c: X + 2.5 });

  state.m1 = m1;
  // Jour précédent : PDH bien au-dessus (cible de liquidité), PDL en dessous.
  state.days = [{ date: "2026-07-21", high: X + 20, low: X - 30 }];

  const tick = mkTick(X + 2.0, START + 124 * 60_000 + 30_000);
  return { state, tick, X };
}

describe("evaluate — entrée ICT sur FVG", () => {
  it("prend un BUY dans le FVG avec biais haussier en kill zone London", () => {
    const { state, tick, X } = buildBullishScenario();
    const session = getSession(tick.ts);
    const r = evaluate(state, tick, session);

    expect(r.bias).toBe("BULLISH");
    expect(r.killzone).toBe("LONDON_KZ");
    expect(r.rejection).toBeNull();
    expect(r.signal).not.toBeNull();

    const s = r.signal!;
    expect(s.side).toBe("BUY");
    expect(["FVG", "Sweep+MSS"]).toContain(s.strategy);
    // SL derrière le bas de la zone (X+0.3 − buffer) → distance cohérente.
    expect(s.slDistance).toBeGreaterThan(1);
    expect(s.slDistance).toBeLessThan(6);
    expect(s.rr).toBeGreaterThanOrEqual(1.3);
    expect(s.rr).toBeLessThanOrEqual(2.6);
    // Honnêteté : winProb plafonnée.
    expect(s.winProb).toBeLessThanOrEqual(0.56);
    expect(s.winProb).toBeGreaterThanOrEqual(0.5);
    // Decision logic renseignée et cible = PDH.
    expect(s.logic.technical).toContain("FVG");
    expect(s.logic.technical).toContain("PDH");
    expect(r.zoneKey).not.toBeNull();
    void X;
  });

  it("ne re-propose pas la même zone (anti-réentrée)", () => {
    const { state, tick } = buildBullishScenario();
    const session = getSession(tick.ts);
    const first = evaluate(state, tick, session);
    const again = evaluate(state, tick, session, {
      recentZoneKeys: [first.zoneKey!],
    });
    expect(again.signal).toBeNull();
    expect(again.rejection).toBeNull(); // pas de setup → silence, pas de spam
  });

  it("durcit le filtre hors kill zone et logge le rejet", () => {
    const { state, X } = buildBullishScenario();
    // Même setup mais à 22:35 UTC (session SYDNEY_ASIA, hors kill zone),
    // entrée profonde dans la zone → SL serré, R:R valable : c'est bien la
    // confluence durcie qui doit rejeter.
    const lateTick = {
      ...mkTick(X + 0.8, Date.UTC(2026, 6, 22, 22, 35, 0)),
    };
    const session = getSession(lateTick.ts);
    const r = evaluate(state, lateTick, session);
    expect(r.killzone).toBeNull();
    expect(r.signal).toBeNull();
    expect(r.rejection).toMatch(/confluence/);
  });

  it("rejette quand la cible de liquidité est trop proche (R:R < 1.3)", () => {
    const { state, tick, X } = buildBullishScenario();
    // PDH juste au-dessus de l'entrée → R:R misérable. Le range high est
    // lui aussi tout proche (X+4.8), donc aucune cible valable.
    state.days = [{ date: "2026-07-21", high: X + 3.0, low: X - 30 }];
    const session = getSession(tick.ts);
    const r = evaluate(state, tick, session);
    expect(r.signal).toBeNull();
    expect(r.rejection).toMatch(/R:R/);
  });

  it("reste silencieux sans historique suffisant", () => {
    const state = initialEngineState(10_000, START);
    const tick = mkTick(4800, START + 60_000);
    const r = evaluate(state, tick, getSession(tick.ts));
    expect(r.signal).toBeNull();
    expect(r.rejection).toBeNull();
  });

  it("reste silencieux quand aucune zone n'est au contact du prix", () => {
    const { state, tick } = buildBullishScenario();
    // Prix loin au-dessus de toute zone.
    const farTick = mkTick(tick.mid + 15, tick.ts);
    const r = evaluate(state, farTick, getSession(farTick.ts));
    expect(r.signal).toBeNull();
    expect(r.rejection).toBeNull();
  });
});
