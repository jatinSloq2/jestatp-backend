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
 * Runs a long-only bar-by-bar simulation: on each candle, if flat and the
 * entry block is true, open a position at that candle's close; while in a
 * position, check exit block / stop loss / target / trailing SL / time exit
 * (in that priority order) using intrabar high/low so a stop that the bar's
 * range touched is honoured even if close didn't confirm it.
 *
 * This mirrors what the strategy builder's DSL actually supports today (a
 * single entry block and a single exit block per strategy, evaluated on one
 * instrument/timeframe) — it does not attempt short-selling or multi-leg
 * position scaling, neither of which the DSL currently expresses.
 */
export function runBacktest(definition: StrategyDefinition, candles: Candle[]): BacktestResult {
  const evaluator = new ConditionEvaluator(candles);
  const { risk } = definition;

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

  // Warm-up: skip the first bar so previous-candle lookbacks (cross_above, price_action prev, etc.) are always available.
  for (let i = 1; i < candles.length; i++) {
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

      // Trailing stop ratchets up as price makes new highs since entry.
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
      } else if (evaluator.evaluateBlock(definition.exit.conditions, definition.exit.logic, i)) {
        exitPrice = c.close;
        reason = 'exit_condition';
      } else if (i === candles.length - 1) {
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

    if (
      !position &&
      tradesToday < risk.maxTradesPerDay &&
      lossToday < risk.maxLossPerDay &&
      evaluator.evaluateBlock(definition.entry.conditions, definition.entry.logic, i)
    ) {
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

  return { candles, trades, equityCurve, stats };
}