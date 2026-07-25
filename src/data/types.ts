// Interface commune de la couche marché (pattern adapter).

import type { Tick } from "../engine/types";

export type FeedStatus = "connecting" | "live" | "error" | "stopped";

export type TickCallback = (tick: Tick) => void;
export type Unsubscribe = () => void;

export interface PriceFeed {
  /** Nom court affiché dans l'UI (source du prix). */
  readonly name: string;
  subscribe(cb: TickCallback): Unsubscribe;
  getLast(): Tick | null;
  status(): FeedStatus;
  start(): void;
  stop(): void;
}

/** High/low de la journée fournis par certains feeds (utilisés au rattrapage). */
export interface DayRange {
  high: number;
  low: number;
}

export interface RangeProvider {
  /** Dernier high/low du jour connu, si le feed le fournit. */
  getDayRange(): DayRange | null;
}

export function hasDayRange(feed: PriceFeed): feed is PriceFeed & RangeProvider {
  return typeof (feed as Partial<RangeProvider>).getDayRange === "function";
}

/** Spread synthétique réaliste (0.30–0.60 $) quand le feed ne donne que le mid. */
export function synthesizeSpread(mid: number, rand: () => number = Math.random): {
  bid: number;
  ask: number;
} {
  const spread = 0.3 + rand() * 0.3;
  return { bid: mid - spread / 2, ask: mid + spread / 2 };
}
