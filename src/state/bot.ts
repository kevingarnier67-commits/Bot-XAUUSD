// BotController : relie feed → brain → risk/executor → store → persistance.
// C'est la seule couche avec des timers ; le moteur reste pur et testable.

import { evaluate } from "../engine/brain";
import { getSession, isMarketOpen } from "../engine/clock";
import { Executor, initialEngineState } from "../engine/executor";
import { computeKpis } from "../engine/stats";
import type { Killzone } from "../engine/clock";
import type { Bias, Tick } from "../engine/types";
import { FeedManager, makeLiveFeed } from "../data";
import {
  clearEngineState,
  loadEngineState,
  saveEngineState,
} from "./persistence";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { patchStore, useAppStore } from "./store";

const TICK_WINDOW = 150; // fenêtre glissante pour le brain et le mini chart
const SUSPENSION_THRESHOLD_MS = 2 * 60_000; // au-delà → rattrapage
const PERSIST_INTERVAL_MS = 15_000;

export class BotController {
  private executor!: Executor;
  private feed: FeedManager | null = null;
  private settings!: Settings;
  private ticks: Tick[] = [];
  private lastBias: Bias | null = null;
  private lastKillzone: Killzone | null = null;
  private recentZones = new Map<string, number>();
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.settings = loadSettings();
    const persisted = await loadEngineState();
    const now = Date.now();

    if (persisted) {
      this.executor = new Executor(persisted);
      this.executor.log("info", "État restauré depuis IndexedDB", now);
    } else {
      this.executor = new Executor(
        initialEngineState(this.settings.initialCapital, now),
      );
      this.executor.log(
        "info",
        `AURUM démarré · capital initial ${this.settings.initialCapital.toFixed(2)} $ · ` +
          "paper trading : prix réels, exécutions simulées",
        now,
      );
    }

    // Rattrapage si l'app était suspendue avec des positions ouvertes.
    const gap = now - this.executor.state.lastTickTs;
    const needsCatchUp =
      this.executor.state.lastTickTs > 0 &&
      gap > SUSPENSION_THRESHOLD_MS &&
      this.executor.state.positions.length > 0;

    this.createFeed();

    if (needsCatchUp) {
      this.awaitFirstTickForCatchUp(gap);
    }

    this.publish();
    patchStore({ hydrated: true, settings: { ...this.settings } });

    this.scheduleScan();
    this.persistTimer = setInterval(() => void this.persist(), PERSIST_INTERVAL_MS);

    window.addEventListener("online", () => this.onConnectivity(true));
    window.addEventListener("offline", () => this.onConnectivity(false));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        void this.persist();
      } else {
        this.onResumeFromBackground();
      }
    });
  }

  private createFeed(): void {
    this.feed?.stop();
    const persistedAnchor = this.lastKnownPrice();
    this.feed = new FeedManager({
      makeLiveFeed: () =>
        makeLiveFeed({
          goldApiIo: this.settings.goldApiIoKey,
          twelveData: this.settings.twelveDataKey,
        }),
      initialAnchor: persistedAnchor,
      onEvent: (message) => {
        this.executor.log("feed", message, Date.now());
        this.publish();
      },
    });
    this.feed.subscribe((tick) => this.onTick(tick));
    this.feed.start();
    this.applyMarketClosedPolicy();
  }

  private lastKnownPrice(): number | undefined {
    const t = this.ticks[this.ticks.length - 1];
    if (t) return t.mid;
    // Dernier prix vu avant fermeture : entrée/SL d'une position ou dernier trade.
    const pos = this.executor.state.positions[0];
    if (pos) return pos.entryPrice;
    const lastTrade =
      this.executor.state.closedTrades[this.executor.state.closedTrades.length - 1];
    return lastTrade?.exitPrice;
  }

  /** Attend le premier tick réel pour exécuter le rattrapage post-suspension. */
  private awaitFirstTickForCatchUp(suspendedMs: number): void {
    const unsub = this.feed!.subscribe((tick) => {
      unsub();
      const range = this.feed!.getDayRange();
      this.executor.catchUp(tick, range, suspendedMs);
      void this.persist();
      this.publish();
    });
  }

  private onResumeFromBackground(): void {
    const state = this.executor.state;
    const gap = Date.now() - state.lastTickTs;
    if (state.lastTickTs > 0 && gap > SUSPENSION_THRESHOLD_MS) {
      if (state.positions.length > 0) {
        this.awaitFirstTickForCatchUp(gap);
      } else {
        this.executor.log(
          "catch_up",
          `Retour après ${Math.round(gap / 60_000)} min de suspension — aucune position à réévaluer`,
          Date.now(),
        );
        this.publish();
      }
    }
  }

  private onConnectivity(online: boolean): void {
    this.executor.log(
      "feed",
      online ? "Connexion réseau rétablie" : "Connexion réseau perdue",
      Date.now(),
    );
    patchStore({ online });
    this.publish();
  }

  private onTick(tick: Tick): void {
    this.ticks.push(tick);
    if (this.ticks.length > TICK_WINDOW) {
      this.ticks.splice(0, this.ticks.length - TICK_WINDOW);
    }

    const closed = this.executor.onTick(tick);
    if (closed.length > 0) void this.persist();

    this.applyMarketClosedPolicy();
    this.publish();
  }

  /** Boucle de scan : fréquence modulée par la session courante. */
  private scheduleScan(): void {
    const session = getSession(Date.now());
    this.scanTimer = setTimeout(() => {
      this.scan();
      this.scheduleScan();
    }, session.scanIntervalMs);
  }

  private scan(): void {
    const now = Date.now();
    const tick = this.feed?.getLast() ?? null;
    if (!tick) return;

    const marketOpen = isMarketOpen(now);
    const trainingOnSim = !marketOpen && this.settings.simWhenClosed;
    if (!marketOpen && !trainingOnSim) return; // marché fermé, pas d'entraînement

    // Analyse ICT sur les bougies persistées, entrée au contact d'une zone.
    const session = getSession(now);
    this.pruneRecentZones(now);
    const result = evaluate(this.executor.state, tick, session, {
      recentZoneKeys: [...this.recentZones.keys()],
    });

    if (result.bias !== this.lastBias) {
      this.executor.log(
        "regime_change",
        `Changement de biais M5 : ${this.lastBias ?? "—"} → ${result.bias}`,
        now,
      );
      this.lastBias = result.bias;
    }
    this.lastKillzone = result.killzone;

    if (result.rejection) {
      this.executor.log("signal_rejected", result.rejection, now);
      if (result.zoneKey) this.recentZones.set(result.zoneKey, now);
    } else if (result.signal) {
      const open = this.executor.tryOpen(result.signal, tick, session);
      if (open.rejection) {
        this.executor.log("signal_rejected", open.rejection, now);
      } else if (open.opened) {
        if (result.zoneKey) this.recentZones.set(result.zoneKey, now);
        this.executor.log(
          "signal_taken",
          `Signal ${result.signal.side} ${result.signal.strategy} accepté ` +
            `(confluence ${result.signal.qualityScore}, winProb ${(result.signal.winProb * 100).toFixed(0)}%, ` +
            `R:R ${result.signal.rr.toFixed(2)})${tick.source === "sim" ? " [SIM]" : ""}`,
          now,
        );
        void this.persist();
      }
    }

    this.publish();
  }

  /** Une zone tradée ou rejetée n'est pas re-considérée pendant 45 min. */
  private pruneRecentZones(now: number): void {
    for (const [key, ts] of this.recentZones) {
      if (now - ts > 45 * 60_000) this.recentZones.delete(key);
    }
  }

  private applyMarketClosedPolicy(): void {
    if (!this.feed) return;
    const marketOpen = isMarketOpen(Date.now());
    this.feed.setSimForced(!marketOpen && this.settings.simWhenClosed);
  }

  private publish(): void {
    const now = Date.now();
    const tick = this.feed?.getLast() ?? null;
    const state = this.executor.state;
    const marketOpen = isMarketOpen(now);

    patchStore({
      tick,
      ticks: [...this.ticks],
      feedMode: this.feed?.mode() ?? "waiting",
      sourceName: this.feed?.sourceName() ?? "—",
      marketOpen,
      status: this.executor.status(now, marketOpen),
      bias: this.lastBias,
      killzone: this.lastKillzone,
      equity: this.executor.equity(tick),
      balance: state.balance,
      initialCapital: state.initialCapital,
      positions: [...state.positions],
      closedTrades: [...state.closedTrades],
      equityCurve: [...state.equityCurve],
      logs: [...state.logs],
      kpis: computeKpis(state.closedTrades, state.equityCurve),
    });
  }

  private async persist(): Promise<void> {
    await saveEngineState(this.executor.state);
  }

  updateSettings(next: Settings): void {
    const feedRelevantChanged =
      next.goldApiIoKey !== this.settings.goldApiIoKey ||
      next.twelveDataKey !== this.settings.twelveDataKey;
    const simToggleChanged = next.simWhenClosed !== this.settings.simWhenClosed;

    this.settings = next;
    saveSettings(next);
    patchStore({ settings: { ...next } });

    if (feedRelevantChanged) {
      this.executor.log("feed", "Clés API modifiées — reconnexion du feed", Date.now());
      this.createFeed();
    }
    if (simToggleChanged) {
      this.applyMarketClosedPolicy();
    }
    this.publish();
  }

  async reset(): Promise<void> {
    await clearEngineState();
    const now = Date.now();
    this.executor = new Executor(
      initialEngineState(this.settings.initialCapital, now),
    );
    this.executor.log(
      "info",
      `Reset complet · capital initial ${this.settings.initialCapital.toFixed(2)} $`,
      now,
    );
    this.lastBias = null;
    this.lastKillzone = null;
    this.recentZones.clear();
    await this.persist();
    this.publish();
  }

  stop(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.feed?.stop();
    this.started = false;
  }
}

/** Singleton applicatif. */
export const bot = new BotController();

// Accès debug en console (aurum.bot / aurum.store).
declare global {
  interface Window {
    aurum?: { bot: BotController; store: typeof useAppStore };
  }
}
if (typeof window !== "undefined") {
  window.aurum = { bot, store: useAppStore };
}
