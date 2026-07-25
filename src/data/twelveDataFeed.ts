// TwelveDataFeed — WebSocket temps réel Twelve Data (clé requise).
// wss://ws.twelvedata.com/v1/quotes/price?apikey=KEY, subscribe XAU/USD.
// Reconnexion avec backoff exponentiel (1s → 60s max).

import { BaseFeed } from "./baseFeed";
import { synthesizeSpread } from "./types";

const WS_URL = "wss://ws.twelvedata.com/v1/quotes/price";
const SYMBOL = "XAU/USD";
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

interface TwelveDataEvent {
  event?: string;
  symbol?: string;
  price?: number;
  bid?: number;
  ask?: number;
  timestamp?: number;
}

export class TwelveDataFeed extends BaseFeed {
  readonly name = "twelvedata";
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly apiKey: string) {
    super();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.feedStatus = "stopped";
  }

  private connect(): void {
    this.feedStatus = "connecting";
    const ws = new WebSocket(`${WS_URL}?apikey=${encodeURIComponent(this.apiKey)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      ws.send(
        JSON.stringify({ action: "subscribe", params: { symbols: SYMBOL } }),
      );
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      let data: TwelveDataEvent;
      try {
        data = JSON.parse(ev.data) as TwelveDataEvent;
      } catch {
        return;
      }
      if (data.event !== "price" || data.symbol !== SYMBOL) return;
      const mid = data.price;
      if (typeof mid !== "number" || !Number.isFinite(mid) || mid <= 0) return;

      let bid = data.bid;
      let ask = data.ask;
      if (
        typeof bid !== "number" ||
        typeof ask !== "number" ||
        !(bid > 0 && ask > bid)
      ) {
        ({ bid, ask } = synthesizeSpread(mid));
      }
      this.emit({ mid, bid, ask, ts: Date.now(), source: this.name });
    };

    ws.onerror = () => {
      this.feedStatus = "error";
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.stopped) return;
      this.feedStatus = "error";
      const delay = Math.min(
        BACKOFF_MAX_MS,
        BACKOFF_BASE_MS * 2 ** this.reconnectAttempts,
      );
      this.reconnectAttempts += 1;
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }
}
