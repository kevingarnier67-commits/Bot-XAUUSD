// Sélection du feed live selon les clés API disponibles (Settings).

import { GoldApiFeed } from "./goldApiFeed";
import { GoldApiIoFeed } from "./goldApiIoFeed";
import { TwelveDataFeed } from "./twelveDataFeed";
import type { PriceFeed } from "./types";

export interface ApiKeys {
  goldApiIo: string;
  twelveData: string;
}

/** Priorité : Twelve Data (WS ~170 ms) > GoldAPI.io (bid/ask réels) > gold-api.com (sans clé). */
export function makeLiveFeed(keys: ApiKeys): PriceFeed {
  if (keys.twelveData.trim()) return new TwelveDataFeed(keys.twelveData.trim());
  if (keys.goldApiIo.trim()) return new GoldApiIoFeed(keys.goldApiIo.trim());
  return new GoldApiFeed();
}

export { FeedManager, FAILOVER_MS, type FeedMode } from "./feedManager";
export { GoldApiFeed } from "./goldApiFeed";
export { GoldApiIoFeed } from "./goldApiIoFeed";
export { TwelveDataFeed } from "./twelveDataFeed";
export { SimFeed, simStep, type SimState } from "./simFeed";
export * from "./types";
