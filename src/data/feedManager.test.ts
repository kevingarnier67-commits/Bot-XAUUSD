// Tests du failover : live en erreur → SimFeed en < 60 s → retour au live.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedManager } from "./feedManager";
import type { FeedStatus, PriceFeed, TickCallback } from "./types";
import type { Tick } from "../engine/types";

class FakeLiveFeed implements PriceFeed {
  readonly name = "fake-live";
  private cbs = new Set<TickCallback>();
  private last: Tick | null = null;
  private st: FeedStatus = "stopped";

  subscribe(cb: TickCallback) {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }
  getLast() {
    return this.last;
  }
  status() {
    return this.st;
  }
  start() {
    this.st = "connecting";
  }
  stop() {
    this.st = "stopped";
  }

  emitPrice(mid: number): void {
    const tick: Tick = {
      mid,
      bid: mid - 0.2,
      ask: mid + 0.2,
      ts: Date.now(),
      source: this.name,
    };
    this.last = tick;
    this.st = "live";
    for (const cb of this.cbs) cb(tick);
  }
}

describe("FeedManager — failover automatique", () => {
  let fake: FakeLiveFeed;
  let manager: FeedManager;
  let events: string[];
  let received: Tick[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T09:00:00Z"));
    fake = new FakeLiveFeed();
    events = [];
    received = [];
    manager = new FeedManager({
      makeLiveFeed: () => fake,
      onEvent: (m) => events.push(m),
    });
    manager.subscribe((t) => received.push(t));
    manager.start();
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  it("bascule en SimFeed en moins de 60 s de silence du live", () => {
    fake.emitPrice(4800);
    expect(manager.mode()).toBe("live");

    // 59 s de silence : toujours en live (pas de bascule prématurée).
    vi.advanceTimersByTime(59_000);
    expect(manager.mode()).toBe("live");

    // Franchit le seuil de 60 s (vérification toutes les 5 s → < 66 s au total).
    vi.advanceTimersByTime(7_000);
    expect(manager.mode()).toBe("sim");
    expect(events.some((e) => e.includes("FLUX SIMULÉ"))).toBe(true);

    // Le sim émet des ticks étiquetés "sim", ancrés sur le dernier prix live.
    vi.advanceTimersByTime(10_000);
    const simTicks = received.filter((t) => t.source === "sim");
    expect(simTicks.length).toBeGreaterThan(0);
    // Ancrage : proche de 4800 (quelques ticks de GBM à 0.8%/jour bougent peu).
    expect(Math.abs(simTicks[simTicks.length - 1]!.mid - 4800)).toBeLessThan(20);
  });

  it("revient au live dès la reconnexion et le logge", () => {
    fake.emitPrice(4800);
    vi.advanceTimersByTime(70_000);
    expect(manager.mode()).toBe("sim");

    fake.emitPrice(4805);
    expect(manager.mode()).toBe("live");
    expect(events.some((e) => e.includes("reconnecté"))).toBe(true);
    expect(received[received.length - 1]!.source).toBe("fake-live");
  });

  it("sans aucune ancre live, refuse de simuler", () => {
    // Aucun tick live jamais reçu, pas d'initialAnchor.
    vi.advanceTimersByTime(70_000);
    expect(manager.mode()).toBe("waiting");
    expect(events.some((e) => e.includes("Aucun prix live"))).toBe(true);
  });

  it("utilise l'ancre persistée si fournie", () => {
    const m2 = new FeedManager({
      makeLiveFeed: () => new FakeLiveFeed(),
      initialAnchor: 4750,
      onEvent: () => {},
    });
    const ticks: Tick[] = [];
    m2.subscribe((t) => ticks.push(t));
    m2.start();
    vi.advanceTimersByTime(70_000);
    expect(m2.mode()).toBe("sim");
    expect(ticks.length).toBeGreaterThan(0);
    expect(Math.abs(ticks[ticks.length - 1]!.mid - 4750)).toBeLessThan(20);
    m2.stop();
  });
});
