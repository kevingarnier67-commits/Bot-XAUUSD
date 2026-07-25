// Tests du RiskManager : sizing exact 1%, anti-martingale, portes de risque.

import { describe, expect, it } from "vitest";
import {
  ANTI_MARTINGALE_FACTOR,
  CONTRACT_SIZE,
  checkRiskGate,
  computeLots,
  isDailyLossBreached,
} from "./risk";

describe("computeLots — sizing fixed fractional 1%", () => {
  it("risque exactement 1% de l'équité pour une distance SL donnée", () => {
    // Équité 10 000 $, SL à 5 $ → risque cible 100 $ → 100 / (5 × 100) = 0.2 lot.
    const lots = computeLots(10_000, 5, 0);
    expect(lots).toBe(0.2);
    const riskedAmount = lots * 5 * CONTRACT_SIZE;
    expect(riskedAmount).toBeCloseTo(10_000 * 0.01, 10);
  });

  it("arrondit au 0.01 lot inférieur (jamais plus de 1% risqué)", () => {
    // Équité 10 000 $, SL à 7 $ → 100 / 700 = 0.1428… → 0.14 lot.
    const lots = computeLots(10_000, 7, 0);
    expect(lots).toBe(0.14);
    expect(lots * 7 * CONTRACT_SIZE).toBeLessThanOrEqual(100);
  });

  it("applique l'anti-martingale ×0.7 par perte consécutive", () => {
    const base = computeLots(10_000, 5, 0);
    const after1 = computeLots(10_000, 5, 1);
    const after2 = computeLots(10_000, 5, 2);
    expect(base).toBe(0.2);
    expect(after1).toBe(0.14); // 0.2 × 0.7
    expect(after2).toBe(0.09); // 0.2 × 0.49, arrondi au 0.01 inférieur
    expect(after1).toBeCloseTo(base * ANTI_MARTINGALE_FACTOR, 2);
  });

  it("plafonne la réduction anti-martingale à 3 pertes", () => {
    expect(computeLots(10_000, 5, 3)).toBe(computeLots(10_000, 5, 10));
  });

  it("retourne 0 pour des entrées invalides", () => {
    expect(computeLots(0, 5, 0)).toBe(0);
    expect(computeLots(10_000, 0, 0)).toBe(0);
  });
});

describe("checkRiskGate", () => {
  const base = {
    equity: 10_000,
    dayStartEquity: 10_000,
    openPositions: 0,
    consecutiveLosses: 0,
    cooldownUntil: 0,
    haltedForDay: "",
    dayKey: "2026-07-24",
    now: 1_000_000,
  };

  it("autorise dans le cas nominal", () => {
    expect(checkRiskGate(base)).toEqual({ allowed: true });
  });

  it("bloque pendant un cooldown", () => {
    const gate = checkRiskGate({ ...base, cooldownUntil: base.now + 60_000 });
    expect(gate.allowed).toBe(false);
  });

  it("bloque au-delà de 3 positions ouvertes", () => {
    const gate = checkRiskGate({ ...base, openPositions: 3 });
    expect(gate.allowed).toBe(false);
  });

  it("bloque quand le jour est halté", () => {
    const gate = checkRiskGate({ ...base, haltedForDay: base.dayKey });
    expect(gate.allowed).toBe(false);
  });

  it("bloque à -3% de perte quotidienne", () => {
    const gate = checkRiskGate({ ...base, equity: 9_699 });
    expect(gate.allowed).toBe(false);
  });
});

describe("isDailyLossBreached", () => {
  it("détecte le franchissement de -3%", () => {
    expect(isDailyLossBreached(9_700, 10_000)).toBe(true);
    expect(isDailyLossBreached(9_701, 10_000)).toBe(false);
  });
});
