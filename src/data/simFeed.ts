// SimFeed — fallback GBM calibré (vol 0.8%/jour) avec clustering GARCH-lite.
// TOUJOURS ancré sur le dernier prix live reçu : aucune ancre hardcodée.
// Clairement étiqueté "sim" — jamais présenté comme un flux réel.

import { BaseFeed } from "./baseFeed";
import { synthesizeSpread } from "./types";

const TICK_MS = 2_000;
const DAILY_VOL = 0.008; // 0.8% par jour
const SECONDS_PER_TRADING_DAY = 24 * 3600;

export interface SimParams {
  anchor: number;
  rng?: () => number;
}

/** État interne du générateur, exposé pour les tests. */
export interface SimState {
  price: number;
  /** Multiplicateur de vol courant (clustering GARCH-lite). */
  volMult: number;
}

/** Gaussienne standard via Box-Muller. */
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Un pas de GBM sans drift avec clustering de volatilité :
 * le multiplicateur de vol fait un retour à la moyenne lent vers 1
 * et est excité par l'amplitude du dernier choc (GARCH-lite).
 */
export function simStep(
  state: SimState,
  dtSeconds: number,
  rng: () => number,
): SimState {
  const baseSigma = DAILY_VOL * Math.sqrt(dtSeconds / SECONDS_PER_TRADING_DAY);
  const z = gaussian(rng);
  const sigma = baseSigma * state.volMult;
  const price = state.price * Math.exp(-0.5 * sigma * sigma + sigma * z);
  // GARCH-lite : persistance 0.92, excitation par |z|, plancher/plafond.
  const volMult = Math.min(
    3,
    Math.max(0.4, 0.92 * state.volMult + 0.08 * (0.6 + Math.abs(z))),
  );
  return { price, volMult };
}

export class SimFeed extends BaseFeed {
  readonly name = "sim";
  private timer: ReturnType<typeof setInterval> | null = null;
  private sim: SimState;
  private readonly rng: () => number;

  constructor(params: SimParams) {
    super();
    if (!(params.anchor > 0)) {
      throw new Error("SimFeed exige une ancre de prix live valide");
    }
    this.sim = { price: params.anchor, volMult: 1 };
    this.rng = params.rng ?? Math.random;
  }

  /** Réancre le simulateur (au retour du live, ou sur nouveau prix réel). */
  reanchor(price: number): void {
    if (price > 0) this.sim = { price, volMult: this.sim.volMult };
  }

  start(): void {
    if (this.timer) return;
    this.feedStatus = "connecting";
    this.emitTick();
    this.timer = setInterval(() => this.emitTick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.feedStatus = "stopped";
  }

  private emitTick(): void {
    this.sim = simStep(this.sim, TICK_MS / 1000, this.rng);
    const mid = this.sim.price;
    const { bid, ask } = synthesizeSpread(mid, this.rng);
    this.emit({ mid, bid, ask, ts: Date.now(), source: this.name });
  }
}
