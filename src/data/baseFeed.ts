// Base commune des adapters : gestion des abonnés, dernier tick, statut.

import type { Tick } from "../engine/types";
import type { FeedStatus, PriceFeed, TickCallback, Unsubscribe } from "./types";

export abstract class BaseFeed implements PriceFeed {
  abstract readonly name: string;
  protected last: Tick | null = null;
  protected feedStatus: FeedStatus = "stopped";
  private subscribers = new Set<TickCallback>();

  subscribe(cb: TickCallback): Unsubscribe {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  getLast(): Tick | null {
    return this.last;
  }

  status(): FeedStatus {
    return this.feedStatus;
  }

  protected emit(tick: Tick): void {
    this.last = tick;
    this.feedStatus = "live";
    for (const cb of this.subscribers) cb(tick);
  }

  abstract start(): void;
  abstract stop(): void;
}
