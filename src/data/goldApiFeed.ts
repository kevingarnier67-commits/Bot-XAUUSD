// GoldApiFeed — adapter par défaut, sans clé ni inscription.
// Polling REST de https://api.gold-api.com/price/XAU toutes les 10 s.
// L'API ne fournit qu'un mid → spread synthétique réaliste (0.30–0.60 $).

import { BaseFeed } from "./baseFeed";
import { synthesizeSpread } from "./types";

const ENDPOINT = "https://api.gold-api.com/price/XAU";
const POLL_MS = 10_000;

interface GoldApiResponse {
  price?: number;
  updatedAt?: string;
}

export class GoldApiFeed extends BaseFeed {
  readonly name = "gold-api.com";
  private timer: ReturnType<typeof setInterval> | null = null;

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
      const res = await fetch(ENDPOINT, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GoldApiResponse;
      const mid = data.price;
      if (typeof mid !== "number" || !Number.isFinite(mid) || mid <= 0) {
        throw new Error("Réponse sans prix valide");
      }
      const { bid, ask } = synthesizeSpread(mid);
      this.emit({ mid, bid, ask, ts: Date.now(), source: this.name });
    } catch {
      this.feedStatus = "error";
    }
  }
}
