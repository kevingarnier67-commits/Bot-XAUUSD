// GoldApiIoFeed — adapter GoldAPI.io (clé requise, saisie dans Settings).
// https://www.goldapi.io/api/XAU/USD avec header x-access-token.
// Fournit bid/ask réels + high/low du jour (utilisé pour le rattrapage
// post-suspension). Polling 15 s pour respecter le quota free tier.

import { BaseFeed } from "./baseFeed";
import { synthesizeSpread, type DayRange, type RangeProvider } from "./types";

const ENDPOINT = "https://www.goldapi.io/api/XAU/USD";
const POLL_MS = 15_000;

interface GoldApiIoResponse {
  price?: number;
  bid?: number;
  ask?: number;
  high_price?: number;
  low_price?: number;
}

export class GoldApiIoFeed extends BaseFeed implements RangeProvider {
  readonly name = "goldapi.io";
  private timer: ReturnType<typeof setInterval> | null = null;
  private dayRange: DayRange | null = null;

  constructor(private readonly apiKey: string) {
    super();
  }

  getDayRange(): DayRange | null {
    return this.dayRange;
  }

  start(): void {
    if (this.timer) return;
    this.feedStatus = "connecting";
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.feedStatus = "stopped";
  }

  private async poll(): Promise<void> {
    try {
      const res = await fetch(ENDPOINT, {
        headers: {
          "x-access-token": this.apiKey,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GoldApiIoResponse;
      const mid = data.price;
      if (typeof mid !== "number" || !Number.isFinite(mid) || mid <= 0) {
        throw new Error("Réponse sans prix valide");
      }

      // bid/ask réels si présents, sinon spread synthétique.
      let bid = data.bid;
      let ask = data.ask;
      if (
        typeof bid !== "number" ||
        typeof ask !== "number" ||
        !(bid > 0 && ask > bid)
      ) {
        ({ bid, ask } = synthesizeSpread(mid));
      }

      if (
        typeof data.high_price === "number" &&
        typeof data.low_price === "number" &&
        data.high_price >= data.low_price
      ) {
        this.dayRange = { high: data.high_price, low: data.low_price };
      }

      this.emit({ mid, bid, ask, ts: Date.now(), source: this.name });
    } catch {
      this.feedStatus = "error";
    }
  }
}
