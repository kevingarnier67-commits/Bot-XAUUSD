// Tests de l'horloge : sessions UTC et détection marché fermé.

import { describe, expect, it } from "vitest";
import { getSession, isMarketOpen } from "./clock";

describe("getSession", () => {
  it("classe les heures UTC dans les bonnes sessions", () => {
    const d = (h: number) => Date.UTC(2026, 6, 22, h, 0, 0); // mercredi
    expect(getSession(d(3)).name).toBe("SYDNEY_ASIA");
    expect(getSession(d(8)).name).toBe("LONDON");
    expect(getSession(d(13)).name).toBe("OVERLAP");
    expect(getSession(d(18)).name).toBe("NEW_YORK");
    expect(getSession(d(21)).name).toBe("CLOSE");
  });

  it("l'overlap a la volatilité et la cadence de scan maximales", () => {
    const overlap = getSession(Date.UTC(2026, 6, 22, 13, 0, 0));
    const asia = getSession(Date.UTC(2026, 6, 22, 3, 0, 0));
    expect(overlap.volFactor).toBeGreaterThan(asia.volFactor);
    expect(overlap.scanIntervalMs).toBeLessThan(asia.scanIntervalMs);
    expect(overlap.minQuality).toBeLessThan(asia.minQuality);
  });
});

describe("isMarketOpen", () => {
  it("ferme du vendredi 21h UTC au dimanche 22h UTC", () => {
    expect(isMarketOpen(Date.UTC(2026, 6, 24, 20, 59, 0))).toBe(true); // ven 20:59
    expect(isMarketOpen(Date.UTC(2026, 6, 24, 21, 0, 0))).toBe(false); // ven 21:00
    expect(isMarketOpen(Date.UTC(2026, 6, 25, 12, 0, 0))).toBe(false); // samedi
    expect(isMarketOpen(Date.UTC(2026, 6, 26, 21, 59, 0))).toBe(false); // dim 21:59
    expect(isMarketOpen(Date.UTC(2026, 6, 26, 22, 0, 0))).toBe(true); // dim 22:00
  });

  it("ferme les jours fériés majeurs", () => {
    expect(isMarketOpen(Date.UTC(2026, 11, 25, 12, 0, 0))).toBe(false); // Noël
    expect(isMarketOpen(Date.UTC(2026, 0, 1, 12, 0, 0))).toBe(false); // Jour de l'an
  });
});
