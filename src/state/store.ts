// Store zustand : instantané de l'état du bot pour l'UI (lecture seule côté React).

import { create } from "zustand";
import type {
  BotStatus,
  ClosedTrade,
  EquityPoint,
  LogEntry,
  Position,
  Regime,
  Tick,
} from "../engine/types";
import type { Kpis } from "../engine/stats";
import type { FeedMode } from "../data";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

export interface AppSnapshot {
  hydrated: boolean;
  tick: Tick | null;
  ticks: Tick[]; // fenêtre récente pour le mini chart
  feedMode: FeedMode;
  sourceName: string;
  online: boolean;
  marketOpen: boolean;
  status: BotStatus;
  regime: Regime | null;
  equity: number;
  balance: number;
  initialCapital: number;
  positions: Position[];
  closedTrades: ClosedTrade[];
  equityCurve: EquityPoint[];
  logs: LogEntry[];
  kpis: Kpis | null;
  settings: Settings;
}

export const useAppStore = create<AppSnapshot>(() => ({
  hydrated: false,
  tick: null,
  ticks: [],
  feedMode: "waiting",
  sourceName: "—",
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  marketOpen: true,
  status: "RUNNING",
  regime: null,
  equity: 0,
  balance: 0,
  initialCapital: 0,
  positions: [],
  closedTrades: [],
  equityCurve: [],
  logs: [],
  kpis: null,
  settings: { ...DEFAULT_SETTINGS },
}));

export function patchStore(patch: Partial<AppSnapshot>): void {
  useAppStore.setState(patch);
}
