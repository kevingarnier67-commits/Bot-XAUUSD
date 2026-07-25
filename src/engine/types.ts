// Types partagés du moteur AURUM. Aucune dépendance React ici.

export interface Tick {
  /** Prix milieu (mid). */
  mid: number;
  /** Bid réel si le feed le fournit, sinon synthétisé. */
  bid: number;
  /** Ask réel si le feed le fournit, sinon synthétisé. */
  ask: number;
  /** Timestamp epoch ms. */
  ts: number;
  /** Source du tick (gold-api, goldapi.io, twelvedata, sim). */
  source: string;
}

export type Side = "BUY" | "SELL";

/** Biais directionnel issu de la structure de marché (ICT). */
export type Bias = "BULLISH" | "BEARISH" | "NEUTRAL";

/** Modèles d'entrée ICT implémentés. */
export type StrategyName = "Sweep+MSS" | "FVG" | "IFVG";

/** Bougie OHLC agrégée depuis les ticks (t = ouverture du bucket, epoch ms). */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** High/low d'un jour UTC clos (liquidité PDH/PDL). */
export interface DayLevel {
  date: string; // YYYY-MM-DD
  high: number;
  low: number;
}

export type SessionName = "SYDNEY_ASIA" | "LONDON" | "OVERLAP" | "NEW_YORK" | "CLOSE";

export interface SessionInfo {
  name: SessionName;
  /** Facteur de volatilité relative de la session (1 = référence London). */
  volFactor: number;
  /** Intervalle de scan du cerveau en ms. */
  scanIntervalMs: number;
  /** Score qualité minimal pour accepter un signal. */
  minQuality: number;
}

export interface DecisionLogic {
  /** Analyse technique : régime, indicateurs, valeurs chiffrées. */
  technical: string;
  /** Contexte : session, volatilité, spread au moment du signal. */
  context: string;
  /** Risque chiffré : % risqué, distance SL, lot, R:R. */
  risk: string;
  /** Score qualité 0–100 du signal. */
  qualityScore: number;
}

export interface Signal {
  side: Side;
  strategy: StrategyName;
  bias: Bias;
  /** Probabilité de gain estimée (0.50–0.56 max, l'edge vient du R:R). */
  winProb: number;
  /** Ratio risque/récompense visé. */
  rr: number;
  /** Distance du SL en points (dollars par once). */
  slDistance: number;
  qualityScore: number;
  logic: DecisionLogic;
  ts: number;
}

export interface Position {
  id: string;
  side: Side;
  strategy: StrategyName;
  bias: Bias;
  /** Taille en lots (1 lot = 100 oz). */
  lots: number;
  entryPrice: number;
  sl: number;
  tp: number;
  openTs: number;
  /** Commission déjà débitée à l'ouverture ($/lot, aller-retour). */
  commission: number;
  /** Swap accumulé (négatif). */
  swapAccrued: number;
  /** Dernier ts où le swap a été accru. */
  lastSwapTs: number;
  logic: DecisionLogic;
}

export type CloseReason = "SL" | "TP" | "CATCH_UP_SL" | "CATCH_UP_TP";

export interface ClosedTrade {
  id: string;
  side: Side;
  strategy: StrategyName;
  bias: Bias;
  lots: number;
  entryPrice: number;
  exitPrice: number;
  sl: number;
  tp: number;
  openTs: number;
  closeTs: number;
  reason: CloseReason;
  /** PnL net (prix + commission + swap). */
  pnl: number;
  commission: number;
  swap: number;
  logic: DecisionLogic;
}

export type BotStatus = "RUNNING" | "COOLDOWN" | "HALTED" | "MARKET_CLOSED";

export type LogKind =
  | "signal_taken"
  | "signal_rejected"
  | "regime_change"
  | "cooldown"
  | "halt"
  | "resume"
  | "feed"
  | "catch_up"
  | "trade_open"
  | "trade_close"
  | "info";

export interface LogEntry {
  ts: number;
  kind: LogKind;
  message: string;
}

export interface EquityPoint {
  ts: number;
  equity: number;
}

/** État complet persisté du moteur. */
export interface EngineState {
  balance: number;
  initialCapital: number;
  positions: Position[];
  closedTrades: ClosedTrade[];
  equityCurve: EquityPoint[];
  logs: LogEntry[];
  consecutiveLosses: number;
  /** Fin du cooldown (epoch ms), 0 si aucun. */
  cooldownUntil: number;
  /** Jour UTC (YYYY-MM-DD) du halt quotidien, "" si aucun. */
  haltedForDay: string;
  /** Équité en début de jour UTC courant, pour la daily loss limit. */
  dayStartEquity: number;
  /** Jour UTC courant (YYYY-MM-DD) du suivi dayStartEquity. */
  dayKey: string;
  /** Dernier ts où le moteur a traité un tick (pour le rattrapage). */
  lastTickTs: number;
  /** Bougies M1 agrégées depuis les ticks (fenêtre glissante persistée). */
  m1: Candle[];
  /** Jours UTC clos : liquidité PDH/PDL. */
  days: DayLevel[];
  /** Jour UTC en cours d'agrégation. */
  curDay: DayLevel | null;
}
