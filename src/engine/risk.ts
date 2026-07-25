// RiskManager : sizing fixed-fractional, anti-martingale, cooldown, daily halt.

export const RISK_PER_TRADE = 0.01; // 1% de l'équité
export const ANTI_MARTINGALE_FACTOR = 0.7; // par perte consécutive
export const ANTI_MARTINGALE_CAP = 3; // nombre max de réductions
export const COOLDOWN_LOSSES = 3; // pertes consécutives déclenchant le cooldown
export const COOLDOWN_MS = 45 * 60_000;
export const DAILY_LOSS_LIMIT = 0.03; // -3% → HALTED jusqu'au jour suivant
export const MAX_POSITIONS = 3;
export const COMMISSION_PER_LOT = 3.5; // $ par lot, débitée à l'ouverture
export const SWAP_PER_LOT_PER_HOUR = -0.45; // $ par lot et par heure
export const CONTRACT_SIZE = 100; // 1 lot XAUUSD = 100 oz → $100 par $ de move
export const MIN_LOTS = 0.01;
export const MAX_LOTS = 5;

/**
 * Taille de position en lots pour risquer exactement 1% de l'équité
 * (réduit par l'anti-martingale) sur la distance SL donnée.
 */
export function computeLots(
  equity: number,
  slDistance: number,
  consecutiveLosses: number,
): number {
  if (equity <= 0 || slDistance <= 0) return 0;
  const reductions = Math.min(consecutiveLosses, ANTI_MARTINGALE_CAP);
  const riskAmount =
    equity * RISK_PER_TRADE * Math.pow(ANTI_MARTINGALE_FACTOR, reductions);
  const rawLots = riskAmount / (slDistance * CONTRACT_SIZE);
  const lots = Math.floor(rawLots / MIN_LOTS) * MIN_LOTS;
  return Math.min(MAX_LOTS, Math.max(0, Number(lots.toFixed(2))));
}

export interface RiskGateInput {
  equity: number;
  dayStartEquity: number;
  openPositions: number;
  consecutiveLosses: number;
  cooldownUntil: number;
  haltedForDay: string;
  dayKey: string;
  now: number;
}

export type RiskGate =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Vérifie toutes les portes de risque avant d'autoriser une nouvelle entrée. */
export function checkRiskGate(input: RiskGateInput): RiskGate {
  if (input.haltedForDay === input.dayKey) {
    return {
      allowed: false,
      reason: `HALTED : daily loss limit -${DAILY_LOSS_LIMIT * 100}% atteinte, reprise au prochain jour UTC`,
    };
  }
  if (input.now < input.cooldownUntil) {
    const minLeft = Math.ceil((input.cooldownUntil - input.now) / 60_000);
    return {
      allowed: false,
      reason: `Cooldown actif encore ${minLeft} min (${COOLDOWN_LOSSES} pertes consécutives)`,
    };
  }
  if (input.openPositions >= MAX_POSITIONS) {
    return {
      allowed: false,
      reason: `Maximum de ${MAX_POSITIONS} positions simultanées atteint`,
    };
  }
  if (input.dayStartEquity > 0) {
    const dayPnlPct = input.equity / input.dayStartEquity - 1;
    if (dayPnlPct <= -DAILY_LOSS_LIMIT) {
      return {
        allowed: false,
        reason: `Daily loss limit -${DAILY_LOSS_LIMIT * 100}% atteinte (${(dayPnlPct * 100).toFixed(2)}%)`,
      };
    }
  }
  return { allowed: true };
}

/** Le jour UTC courant a-t-il franchi la limite de perte quotidienne ? */
export function isDailyLossBreached(equity: number, dayStartEquity: number): boolean {
  if (dayStartEquity <= 0) return false;
  return equity / dayStartEquity - 1 <= -DAILY_LOSS_LIMIT;
}
