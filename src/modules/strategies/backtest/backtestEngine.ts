import { Candle } from '../../brokers/adapters/brokerAdapter.interface';
import { StrategyDefinition } from '../dsl/types';
import { ConditionEvaluator } from './conditionEvaluator';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDayKey(timestamp: number): string {
  return new Date(timestamp + IST_OFFSET_MS).toISOString().slice(0, 10);
}
function istTimeOfDay(timestamp: number): string {
  const ist = new Date(timestamp + IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
}

export interface BacktestTrade {
  entryIndex: number;
  exitIndex: number;
  entryTimestamp: number;
  exitTimestamp: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  exitReason: 'exit_condition' | 'stop_loss' | 'target' | 'trailing_stop_loss' | 'time_exit' | 'end_of_data';
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
}

export interface BacktestStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  totalPnl: number;
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  profitFactor: number | null;
  averagePnlPerTrade: number;
  bestTrade: number;
  worstTrade: number;
}

export interface BacktestResult {
  candles: Candle[];
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  stats: BacktestStats;
  /**
   * Only ever set when `simulateTrades` is called with `forceCloseAtEnd:
   * false` (the live engine — see liveEngine.ts) AND a position was still
   * open on the final bar. Backtests always force-close on the last bar
   * (the default), so this is always null from `runBacktest`/
   * `runPythonBacktest` — it exists on the shared type rather than a
   * separate one so both callers can use the same BacktestResult shape.
   */
  openPosition: OpenPositionSnapshot | null;
}

export interface OpenPositionSnapshot {
  entryIndex: number;
  entryTimestamp: number;
  entryPrice: number;
  quantity: number;
  stopLossPrice: number;
  targetPrice: number;
  trailingStopPrice: number | null;
}

function computeQuantity(
  method: StrategyDefinition['risk']['positionSizing']['method'],
  value: number,
  entryPrice: number,
  capitalAllocated: number,
): number {
  if (entryPrice <= 0) return 0;
  switch (method) {
    case 'fixed_quantity':
      return Math.max(0, Math.floor(value));
    case 'fixed_capital':
      return Math.max(0, Math.floor(value / entryPrice));
    case 'percent_of_capital':
      return Math.max(0, Math.floor((capitalAllocated * (value / 100)) / entryPrice));
    default:
      return 0;
  }
}

function resolveStopOrTarget(entryPrice: number, config: { type: 'percent' | 'points'; value: number }, direction: 1 | -1): number {
  if (config.type === 'percent') {
    return entryPrice + direction * entryPrice * (config.value / 100);
  }
  return entryPrice + direction * config.value;
}

/**
 * Runs a long-only bar-by-bar risk-management simulation: on each candle, if
 * flat and `entrySignalAt(i)` is true, open a position at that candle's
 * close; while in a position, check `exitSignalAt(i)` / stop loss / target /
 * trailing SL / time exit (in that priority order) using intrabar high/low
 * so a stop that the bar's range touched is honoured even if close didn't
 * confirm it.
 *
 * This is the part of the engine that's identical regardless of *how* the
 * entry/exit decision was made — a DSL condition block (`runBacktest` below)
 * and a custom Python `on_bar()` strategy (`pythonBacktestEngine.ts`) both
 * boil down to "is there an entry signal on bar i" / "is there an exit
 * signal on bar i" and hand that off to this same simulation, so stop
 * loss/target/trailing/time-exit/position-sizing behave identically and stay
 * in exactly one place no matter which language authored the signals.
 */
export function simulateTrades(
  candles: Candle[],
  risk: StrategyDefinition['risk'],
  entrySignalAt: (index: number) => boolean,
  exitSignalAt: (index: number) => boolean,
  startIndex = 1,
  options: { forceCloseAtEnd?: boolean } = {},
): BacktestResult {
  const forceCloseAtEnd = options.forceCloseAtEnd ?? true;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  let capital = risk.capitalAllocated;
  let peakCapital = capital;
  let maxDrawdownPercent = 0;

  let position: {
    entryIndex: number;
    entryPrice: number;
    quantity: number;
    stopLossPrice: number;
    targetPrice: number;
    trailingStopPrice: number | null;
  } | null = null;

  let tradesToday = 0;
  let lossToday = 0;
  let currentDay = '';

  for (let i = startIndex; i < candles.length; i++) {
    const c = candles[i];
    const day = istDayKey(c.timestamp);
    if (day !== currentDay) {
      currentDay = day;
      tradesToday = 0;
      lossToday = 0;
    }

    if (position) {
      let exitPrice: number | null = null;
      let reason: BacktestTrade['exitReason'] | null = null;

      if (risk.trailingStopLoss?.enabled) {
        const trailDistance =
          risk.trailingStopLoss.type === 'percent'
            ? position.entryPrice * (risk.trailingStopLoss.value / 100)
            : risk.trailingStopLoss.value;
        const candidate = c.high - trailDistance;
        if (position.trailingStopPrice === null || candidate > position.trailingStopPrice) {
          position.trailingStopPrice = candidate;
        }
      }

      if (c.low <= position.stopLossPrice) {
        exitPrice = position.stopLossPrice;
        reason = 'stop_loss';
      } else if (position.trailingStopPrice !== null && c.low <= position.trailingStopPrice) {
        exitPrice = position.trailingStopPrice;
        reason = 'trailing_stop_loss';
      } else if (c.high >= position.targetPrice) {
        exitPrice = position.targetPrice;
        reason = 'target';
      } else if (risk.timeBasedExit?.enabled && istTimeOfDay(c.timestamp) >= risk.timeBasedExit.exitTime) {
        exitPrice = c.close;
        reason = 'time_exit';
      } else if (exitSignalAt(i)) {
        exitPrice = c.close;
        reason = 'exit_condition';
      } else if (forceCloseAtEnd && i === candles.length - 1) {
        exitPrice = c.close;
        reason = 'end_of_data';
      }

      if (exitPrice !== null && reason) {
        const pnl = (exitPrice - position.entryPrice) * position.quantity;
        capital += pnl;
        if (pnl < 0) lossToday += Math.abs(pnl);

        trades.push({
          entryIndex: position.entryIndex,
          exitIndex: i,
          entryTimestamp: candles[position.entryIndex].timestamp,
          exitTimestamp: c.timestamp,
          entryPrice: position.entryPrice,
          exitPrice,
          quantity: position.quantity,
          pnl,
          pnlPercent: (pnl / (position.entryPrice * position.quantity)) * 100,
          exitReason: reason,
        });
        position = null;
      }
    }

    if (!position && tradesToday < risk.maxTradesPerDay && lossToday < risk.maxLossPerDay && entrySignalAt(i)) {
      const entryPrice = c.close;
      const quantity = computeQuantity(risk.positionSizing.method, risk.positionSizing.value, entryPrice, risk.capitalAllocated);
      if (quantity > 0) {
        position = {
          entryIndex: i,
          entryPrice,
          quantity,
          stopLossPrice: resolveStopOrTarget(entryPrice, risk.stopLoss, -1),
          targetPrice: resolveStopOrTarget(entryPrice, risk.target, 1),
          trailingStopPrice: null,
        };
        tradesToday += 1;
      }
    }

    peakCapital = Math.max(peakCapital, capital);
    const drawdown = peakCapital > 0 ? ((peakCapital - capital) / peakCapital) * 100 : 0;
    maxDrawdownPercent = Math.max(maxDrawdownPercent, drawdown);

    equityCurve.push({ timestamp: c.timestamp, equity: capital });
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

  const stats: BacktestStats = {
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRatePercent: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    totalPnl,
    totalReturnPercent: risk.capitalAllocated > 0 ? (totalPnl / risk.capitalAllocated) * 100 : 0,
    maxDrawdownPercent,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    averagePnlPerTrade: trades.length > 0 ? totalPnl / trades.length : 0,
    bestTrade: trades.length > 0 ? Math.max(...trades.map((t) => t.pnl)) : 0,
    worstTrade: trades.length > 0 ? Math.min(...trades.map((t) => t.pnl)) : 0,
  };

  return {
    candles,
    trades,
    equityCurve,
    stats,
    openPosition: position
      ? {
          entryIndex: position.entryIndex,
          entryTimestamp: candles[position.entryIndex].timestamp,
          entryPrice: position.entryPrice,
          quantity: position.quantity,
          stopLossPrice: position.stopLossPrice,
          targetPrice: position.targetPrice,
          trailingStopPrice: position.trailingStopPrice,
        }
      : null,
  };
}

/**
 * DSL entry point: evaluates the strategy's entry/exit condition blocks
 * bar-by-bar and hands the resulting signals to `simulateTrades`. Warm-up
 * starts at index 1 so previous-candle lookbacks (cross_above, price_action
 * prev, etc.) are always available on the first bar evaluated.
 */
export function runBacktest(definition: StrategyDefinition, candles: Candle[]): BacktestResult {
  const evaluator = new ConditionEvaluator(candles);
  return simulateTrades(
    candles,
    definition.risk,
    (i) => evaluator.evaluateBlock(definition.entry.conditions, definition.entry.logic, i),
    (i) => evaluator.evaluateBlock(definition.exit.conditions, definition.exit.logic, i),
    1,
  );
}