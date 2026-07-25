// Executor : orchestrateur du moteur. Exécutions SIMULÉES sur prix réels.
// Aucun ordre réel n'est passé — spread, slippage, commission et swap sont modélisés.

import { dayKeyUTC } from "./clock";
import {
  COMMISSION_PER_LOT,
  CONTRACT_SIZE,
  COOLDOWN_LOSSES,
  COOLDOWN_MS,
  MIN_LOTS,
  SWAP_PER_LOT_PER_HOUR,
  checkRiskGate,
  computeLots,
  isDailyLossBreached,
} from "./risk";
import type {
  BotStatus,
  ClosedTrade,
  EngineState,
  LogEntry,
  LogKind,
  Position,
  SessionInfo,
  Signal,
  Tick,
} from "./types";
import type { Rng } from "./brain";

const MAX_LOGS = 500;
const MAX_EQUITY_POINTS = 5000;
const EQUITY_POINT_MIN_INTERVAL_MS = 60_000;

export function initialEngineState(capital: number, now: number): EngineState {
  return {
    balance: capital,
    initialCapital: capital,
    positions: [],
    closedTrades: [],
    equityCurve: [{ ts: now, equity: capital }],
    logs: [],
    consecutiveLosses: 0,
    cooldownUntil: 0,
    haltedForDay: "",
    dayStartEquity: capital,
    dayKey: dayKeyUTC(now),
    lastTickTs: 0,
  };
}

export interface OpenResult {
  opened: Position | null;
  rejection: string | null;
}

export class Executor {
  readonly state: EngineState;
  private readonly rng: Rng;
  private idCounter = 0;

  constructor(state: EngineState, rng: Rng = Math.random) {
    this.state = state;
    this.rng = rng;
  }

  log(kind: LogKind, message: string, ts: number): void {
    const entry: LogEntry = { ts, kind, message };
    this.state.logs.push(entry);
    if (this.state.logs.length > MAX_LOGS) {
      this.state.logs.splice(0, this.state.logs.length - MAX_LOGS);
    }
  }

  /** Équité = balance + PnL latent des positions ouvertes au prix donné. */
  equity(tick: Tick | null): number {
    let eq = this.state.balance;
    if (tick) {
      for (const p of this.state.positions) {
        eq += this.unrealizedPnl(p, tick);
      }
    }
    return eq;
  }

  unrealizedPnl(p: Position, tick: Tick): number {
    const mark = p.side === "BUY" ? tick.bid : tick.ask;
    const priceDiff = p.side === "BUY" ? mark - p.entryPrice : p.entryPrice - mark;
    return priceDiff * p.lots * CONTRACT_SIZE + p.swapAccrued - p.commission;
  }

  status(now: number, marketOpen: boolean): BotStatus {
    if (!marketOpen) return "MARKET_CLOSED";
    if (this.state.haltedForDay === this.state.dayKey) return "HALTED";
    if (now < this.state.cooldownUntil) return "COOLDOWN";
    return "RUNNING";
  }

  /** Bascule de jour UTC : réarme la daily loss limit et lève le halt. */
  maybeRollDay(now: number, tick: Tick | null): void {
    const key = dayKeyUTC(now);
    if (key === this.state.dayKey) return;
    const wasHalted = this.state.haltedForDay === this.state.dayKey;
    this.state.dayKey = key;
    this.state.dayStartEquity = this.equity(tick);
    if (wasHalted) {
      this.state.haltedForDay = "";
      this.log("resume", "Nouveau jour UTC : halt quotidien levé, trading réactivé", now);
    }
  }

  /**
   * Traite un tick : accrue le swap, surveille SL/TP, met à jour la courbe d'équité.
   * Retourne les trades fermés par ce tick.
   */
  onTick(tick: Tick): ClosedTrade[] {
    this.maybeRollDay(tick.ts, tick);
    const closed: ClosedTrade[] = [];

    for (const p of [...this.state.positions]) {
      this.accrueSwap(p, tick.ts);
      const trade = this.checkStops(p, tick);
      if (trade) closed.push(trade);
    }

    this.state.lastTickTs = tick.ts;
    this.pushEquityPoint(tick.ts, this.equity(tick), closed.length > 0);
    return closed;
  }

  private accrueSwap(p: Position, now: number): void {
    const hours = (now - p.lastSwapTs) / 3_600_000;
    if (hours <= 0) return;
    p.swapAccrued += SWAP_PER_LOT_PER_HOUR * p.lots * hours;
    p.lastSwapTs = now;
  }

  /** Clôture au toucher du SL/TP sur le prix pertinent (bid pour BUY, ask pour SELL). */
  private checkStops(p: Position, tick: Tick): ClosedTrade | null {
    const mark = p.side === "BUY" ? tick.bid : tick.ask;
    if (p.side === "BUY") {
      if (mark <= p.sl) return this.close(p, p.sl, "SL", tick.ts);
      if (mark >= p.tp) return this.close(p, p.tp, "TP", tick.ts);
    } else {
      if (mark >= p.sl) return this.close(p, p.sl, "SL", tick.ts);
      if (mark <= p.tp) return this.close(p, p.tp, "TP", tick.ts);
    }
    return null;
  }

  private close(
    p: Position,
    exitPrice: number,
    reason: ClosedTrade["reason"],
    now: number,
  ): ClosedTrade {
    this.accrueSwap(p, now);
    const priceDiff =
      p.side === "BUY" ? exitPrice - p.entryPrice : p.entryPrice - exitPrice;
    const pnl = priceDiff * p.lots * CONTRACT_SIZE + p.swapAccrued - p.commission;

    const trade: ClosedTrade = {
      id: p.id,
      side: p.side,
      strategy: p.strategy,
      regime: p.regime,
      lots: p.lots,
      entryPrice: p.entryPrice,
      exitPrice,
      sl: p.sl,
      tp: p.tp,
      openTs: p.openTs,
      closeTs: now,
      reason,
      pnl,
      commission: p.commission,
      swap: p.swapAccrued,
      logic: p.logic,
    };

    this.state.balance += pnl;
    this.state.positions = this.state.positions.filter((x) => x.id !== p.id);
    this.state.closedTrades.push(trade);

    const isLoss = pnl < 0;
    if (isLoss) {
      this.state.consecutiveLosses += 1;
      if (this.state.consecutiveLosses >= COOLDOWN_LOSSES && this.state.consecutiveLosses % COOLDOWN_LOSSES === 0) {
        this.state.cooldownUntil = now + COOLDOWN_MS;
        this.log(
          "cooldown",
          `${COOLDOWN_LOSSES} pertes consécutives → cooldown 45 min`,
          now,
        );
      }
    } else {
      this.state.consecutiveLosses = 0;
    }

    this.log(
      "trade_close",
      `Clôture ${trade.side} ${trade.lots} lot @ ${exitPrice.toFixed(2)} ` +
        `(${reason}) · PnL ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} $`,
      now,
    );

    if (isDailyLossBreached(this.state.balance, this.state.dayStartEquity)) {
      if (this.state.haltedForDay !== this.state.dayKey) {
        this.state.haltedForDay = this.state.dayKey;
        this.log(
          "halt",
          "Daily loss limit -3% atteinte → HALTED jusqu'au prochain jour UTC",
          now,
        );
      }
    }

    this.pushEquityPoint(now, this.state.balance, true);
    return trade;
  }

  /**
   * Tente d'ouvrir une position sur un signal accepté par le brain.
   * Applique les portes de risque, le sizing 1% et le slippage de session.
   */
  tryOpen(signal: Signal, tick: Tick, session: SessionInfo): OpenResult {
    const now = tick.ts;
    this.maybeRollDay(now, tick);

    const gate = checkRiskGate({
      equity: this.equity(tick),
      dayStartEquity: this.state.dayStartEquity,
      openPositions: this.state.positions.length,
      consecutiveLosses: this.state.consecutiveLosses,
      cooldownUntil: this.state.cooldownUntil,
      haltedForDay: this.state.haltedForDay,
      dayKey: this.state.dayKey,
      now,
    });
    if (!gate.allowed) {
      return { opened: null, rejection: gate.reason };
    }

    const equity = this.equity(tick);
    const lots = computeLots(equity, signal.slDistance, this.state.consecutiveLosses);
    if (lots < MIN_LOTS) {
      return { opened: null, rejection: "Taille calculée sous le lot minimum (0.01)" };
    }

    // Slippage aléatoire proportionnel à la volatilité de session, toujours défavorable.
    const slippage = this.rng() * 0.08 * session.volFactor;
    const entryPrice =
      signal.side === "BUY" ? tick.ask + slippage : tick.bid - slippage;

    const sl =
      signal.side === "BUY"
        ? entryPrice - signal.slDistance
        : entryPrice + signal.slDistance;
    const tp =
      signal.side === "BUY"
        ? entryPrice + signal.slDistance * signal.rr
        : entryPrice - signal.slDistance * signal.rr;

    const commission = COMMISSION_PER_LOT * lots;
    const riskAmount = signal.slDistance * lots * CONTRACT_SIZE;

    const position: Position = {
      id: `T${now}-${++this.idCounter}`,
      side: signal.side,
      strategy: signal.strategy,
      regime: signal.regime,
      lots,
      entryPrice,
      sl,
      tp,
      openTs: now,
      commission,
      swapAccrued: 0,
      lastSwapTs: now,
      logic: {
        ...signal.logic,
        risk:
          `Risque ${(riskAmount / Math.max(equity, 1) * 100).toFixed(2)}% ` +
          `(${riskAmount.toFixed(2)} $) · SL à ${signal.slDistance.toFixed(2)} $ · ` +
          `${lots} lot · R:R ${signal.rr.toFixed(2)} · ` +
          `slippage ${slippage.toFixed(2)} $ · commission ${commission.toFixed(2)} $`,
      },
    };

    this.state.positions.push(position);
    this.log(
      "trade_open",
      `Ouverture ${position.side} ${lots} lot @ ${entryPrice.toFixed(2)} ` +
        `(${signal.strategy}, qualité ${signal.qualityScore}) · ` +
        `SL ${sl.toFixed(2)} · TP ${tp.toFixed(2)}`,
      now,
    );

    return { opened: position, rejection: null };
  }

  /**
   * Rattrapage après suspension (PWA iOS en arrière-plan) : réévalue les
   * positions ouvertes contre SL/TP avec le high/low de la période manquée
   * si disponible, sinon le prix courant. Ne prétend JAMAIS avoir tradé
   * pendant la suspension.
   */
  catchUp(
    tick: Tick,
    missedRange: { high: number; low: number } | null,
    suspendedMs: number,
  ): ClosedTrade[] {
    const now = tick.ts;
    this.maybeRollDay(now, tick);
    const closed: ClosedTrade[] = [];
    const minutes = Math.round(suspendedMs / 60_000);

    for (const p of [...this.state.positions]) {
      this.accrueSwap(p, now);
      const high = missedRange ? Math.max(missedRange.high, tick.mid) : tick.mid;
      const low = missedRange ? Math.min(missedRange.low, tick.mid) : tick.mid;

      let trade: ClosedTrade | null = null;
      if (p.side === "BUY") {
        // Conservateur : si le SL et le TP étaient tous deux dans le range
        // manqué, on suppose le pire (SL touché en premier).
        if (low <= p.sl) trade = this.close(p, p.sl, "CATCH_UP_SL", now);
        else if (high >= p.tp) trade = this.close(p, p.tp, "CATCH_UP_TP", now);
      } else {
        if (high >= p.sl) trade = this.close(p, p.sl, "CATCH_UP_SL", now);
        else if (low <= p.tp) trade = this.close(p, p.tp, "CATCH_UP_TP", now);
      }
      if (trade) closed.push(trade);
    }

    this.log(
      "catch_up",
      `Rattrapage après suspension (${minutes} min hors ligne) : ` +
        `${closed.length} position(s) clôturée(s) sur le range manqué, ` +
        `aucun trade pris pendant la suspension`,
      now,
    );

    this.state.lastTickTs = now;
    this.pushEquityPoint(now, this.equity(tick), true);
    return closed;
  }

  private pushEquityPoint(ts: number, equity: number, force: boolean): void {
    const curve = this.state.equityCurve;
    const last = curve[curve.length - 1];
    if (!force && last && ts - last.ts < EQUITY_POINT_MIN_INTERVAL_MS) return;
    curve.push({ ts, equity });
    if (curve.length > MAX_EQUITY_POINTS) {
      curve.splice(0, curve.length - MAX_EQUITY_POINTS);
    }
  }
}
