// FeedManager — failover automatique entre le feed live et le SimFeed.
// Si le live ne donne plus de tick pendant > 60 s → SimFeed ancré sur le
// dernier prix live, bannière "FLUX SIMULÉ". Retour au live dès reconnexion.

import type { Tick } from "../engine/types";
import { SimFeed } from "./simFeed";
import {
  hasDayRange,
  type DayRange,
  type PriceFeed,
  type TickCallback,
  type Unsubscribe,
} from "./types";

export type FeedMode = "live" | "sim" | "waiting";

export const FAILOVER_MS = 60_000;
const CHECK_INTERVAL_MS = 5_000;

export interface FeedManagerOptions {
  /** Fabrique du feed live primaire (choisi selon les clés API). */
  makeLiveFeed: () => PriceFeed;
  /** Ancre initiale pour le sim si aucun tick live encore reçu (état persisté). */
  initialAnchor?: number;
  now?: () => number;
  failoverMs?: number;
  onEvent?: (message: string) => void;
}

export class FeedManager {
  private live: PriceFeed;
  private sim: SimFeed | null = null;
  private currentMode: FeedMode = "waiting";
  private lastLiveTick: Tick | null = null;
  private lastTick: Tick | null = null;
  private subscribers = new Set<TickCallback>();
  private unsubLive: Unsubscribe | null = null;
  private unsubSim: Unsubscribe | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private simForced = false;
  private readonly now: () => number;
  private readonly failoverMs: number;
  private readonly initialAnchor: number | undefined;
  private readonly onEvent: (message: string) => void;

  constructor(opts: FeedManagerOptions) {
    this.live = opts.makeLiveFeed();
    this.now = opts.now ?? Date.now;
    this.failoverMs = opts.failoverMs ?? FAILOVER_MS;
    this.initialAnchor = opts.initialAnchor;
    this.onEvent = opts.onEvent ?? (() => {});
  }

  subscribe(cb: TickCallback): Unsubscribe {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  getLast(): Tick | null {
    return this.lastTick;
  }

  getLastLive(): Tick | null {
    return this.lastLiveTick;
  }

  mode(): FeedMode {
    return this.currentMode;
  }

  sourceName(): string {
    return this.currentMode === "sim" ? "sim" : this.live.name;
  }

  /** High/low du jour si le feed live le fournit (GoldAPI.io). */
  getDayRange(): DayRange | null {
    return hasDayRange(this.live) ? this.live.getDayRange() : null;
  }

  start(): void {
    if (this.timer) return;
    this.startedAt = this.now();
    this.unsubLive = this.live.subscribe((tick) => this.onLiveTick(tick));
    this.live.start();
    this.timer = setInterval(() => this.checkFailover(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubLive?.();
    this.unsubLive = null;
    this.live.stop();
    this.stopSim();
  }

  /** Toggle "s'entraîner marché fermé" : force le sim même si le live répond. */
  setSimForced(forced: boolean): void {
    if (this.simForced === forced) return;
    this.simForced = forced;
    if (forced) {
      this.activateSim("SimFeed forcé (entraînement marché fermé)");
    } else {
      this.onEvent("SimFeed forcé désactivé — attente du flux live");
      this.stopSim();
      this.currentMode = this.lastLiveTick ? "live" : "waiting";
    }
  }

  private onLiveTick(tick: Tick): void {
    this.lastLiveTick = tick;
    this.sim?.reanchor(tick.mid);
    if (this.simForced) return; // en mode forcé, le live ne fait que réancrer
    if (this.currentMode === "sim") {
      this.stopSim();
      this.onEvent(`Flux live reconnecté (${this.live.name}) — retour au prix réel`);
    }
    if (this.currentMode !== "live") {
      this.currentMode = "live";
    }
    this.forward(tick);
  }

  /** Vérifie l'âge du dernier tick live ; bascule en sim au-delà du seuil. */
  checkFailover(): void {
    if (this.simForced || this.currentMode === "sim") return;
    const ref = this.lastLiveTick?.ts ?? this.startedAt;
    if (this.now() - ref > this.failoverMs) {
      this.activateSim(
        `Flux live silencieux depuis plus de ${Math.round(this.failoverMs / 1000)} s — bascule en FLUX SIMULÉ`,
      );
    }
  }

  private activateSim(reason: string): void {
    const anchor = this.lastLiveTick?.mid ?? this.initialAnchor;
    if (!anchor || !(anchor > 0)) {
      // Aucune ancre live disponible : impossible de simuler honnêtement.
      this.currentMode = "waiting";
      this.onEvent("Aucun prix live reçu — simulation impossible sans ancre réelle");
      return;
    }
    if (!this.sim) {
      this.sim = new SimFeed({ anchor });
    } else {
      this.sim.reanchor(this.lastLiveTick?.mid ?? anchor);
    }
    if (!this.unsubSim) {
      this.unsubSim = this.sim.subscribe((tick) => {
        if (this.currentMode === "sim") this.forward(tick);
      });
    }
    this.currentMode = "sim";
    this.sim.start();
    this.onEvent(reason);
  }

  private stopSim(): void {
    this.unsubSim?.();
    this.unsubSim = null;
    this.sim?.stop();
  }

  private forward(tick: Tick): void {
    this.lastTick = tick;
    for (const cb of this.subscribers) cb(tick);
  }
}
