import { Candle } from '../../brokers/adapters/brokerAdapter.interface';
import { StrategyDefinition } from '../dsl/types';
import { ConditionEvaluator, ConditionExplanation } from './conditionEvaluator';

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
  /**
   * Only populated for DSL strategies (see `explainEntryAt` on
   * `simulateTrades` and `runBacktest` below) — the "Conditions at Entry"
   * debugger the design doc describes: which leaf conditions were true and
   * what value each one actually saw, at the single bar this trade opened
   * on. Python strategies don't get this (there's no fixed condition tree
   * to walk) — `ctx.log(...)` inside `on_bar` is the equivalent there, see
   * BacktestResult.logs.
   */
  entryExplanation?: ConditionExplanation;
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
  /**
   * Annualized Sharpe ratio computed from day-over-day equity-curve
   * returns (mean / stdev * sqrt(252) — 252 trading days/year, the
   * standard NSE-convention annualization factor). `null` when there are
   * fewer than 2 trading days in the run or the daily returns have zero
   * variance (a flat equity curve, e.g. no trades at all) — a Sharpe ratio
   * isn't meaningful in either case, so this is left unset rather than
   * shown as a misleading 0.
   */
  sharpeRatio: number | null;
  /** The strategy's configured starting capital — carried through onto stats so callers (e.g. the Monte Carlo panel) can show "% above/below starting capital" without needing the strategy definition itself. */
  startingCapital: number;
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

/** Day-over-day % returns of the equity curve's last value each calendar day (IST) — the basis for Sharpe ratio. */
function dailyReturns(equityCurve: EquityPoint[]): number[] {
  const lastByDay = new Map<string, number>();
  for (const point of equityCurve) {
    lastByDay.set(istDayKey(point.timestamp), point.equity);
  }
  const values = Array.from(lastByDay.values());
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) returns.push((values[i] - values[i - 1]) / values[i - 1]);
  }
  return returns;
}

function computeSharpeRatio(equityCurve: EquityPoint[]): number | null {
  const returns = dailyReturns(equityCurve);
  if (returns.length < 2) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return null;
  return (mean / stdev) * Math.sqrt(252);
}

function buildStats(trades: BacktestTrade[], risk: StrategyDefinition['risk'], maxDrawdownPercent: number, equityCurve: EquityPoint[]): BacktestStats {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

  return {
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
    sharpeRatio: computeSharpeRatio(equityCurve),
    startingCapital: risk.capitalAllocated,
  };
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
  options: { forceCloseAtEnd?: boolean; explainEntryAt?: (index: number) => ConditionExplanation | undefined } = {},
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
    entryExplanation?: ConditionExplanation;
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
          entryExplanation: position.entryExplanation,
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
          entryExplanation: options.explainEntryAt?.(i),
        };
        tradesToday += 1;
      }
    }

    peakCapital = Math.max(peakCapital, capital);
    const drawdown = peakCapital > 0 ? ((peakCapital - capital) / peakCapital) * 100 : 0;
    maxDrawdownPercent = Math.max(maxDrawdownPercent, drawdown);

    equityCurve.push({ timestamp: c.timestamp, equity: capital });
  }

  const stats = buildStats(trades, risk, maxDrawdownPercent, equityCurve);

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
    { explainEntryAt: (i) => evaluator.explainBlock(definition.entry.conditions, definition.entry.logic, i) },
  );
}

// ─────────────────────────── Walk-forward testing ───────────────────────────

export interface WalkForwardFold {
  trainFrom: number;
  trainTo: number;
  testFrom: number;
  testTo: number;
  testResult: BacktestResult;
}

export interface WalkForwardResult {
  folds: WalkForwardFold[];
  /** Stats pooled across every fold's *test* (out-of-sample) window only — this is the number that matters; the train windows exist only to mark where each test window starts. */
  combinedTestStats: BacktestStats;
}

/**
 * Splits `candles` into `folds` consecutive train/test windows (each test
 * window immediately follows its train window, and folds don't overlap)
 * and runs the *same* strategy definition's out-of-sample (test) segment
 * in each — there's no parameter re-fitting on the train segment (this
 * engine has no optimizer), so "train" here just marks the warm-up/lookback
 * region that's fed to the strategy but excluded from the reported stats,
 * consistent with how the design doc frames walk-forward as validating
 * that a strategy holds up out-of-sample across multiple periods rather
 * than a single lucky date range.
 *
 * `testFraction` (default 0.3) is the share of each fold given to the test
 * window; the rest is train/warm-up.
 */
export function runWalkForward(
  definition: StrategyDefinition,
  candles: Candle[],
  folds = 3,
  testFraction = 0.3,
): WalkForwardResult {
  const evaluator = new ConditionEvaluator(candles);
  const entryAt = (i: number) => evaluator.evaluateBlock(definition.entry.conditions, definition.entry.logic, i);
  const exitAt = (i: number) => evaluator.evaluateBlock(definition.exit.conditions, definition.exit.logic, i);
  const explainEntryAt = (i: number) => evaluator.explainBlock(definition.entry.conditions, definition.entry.logic, i);

  const foldSize = Math.floor(candles.length / folds);
  const results: WalkForwardFold[] = [];

  for (let f = 0; f < folds; f++) {
    const foldStart = f * foldSize;
    const foldEnd = f === folds - 1 ? candles.length : foldStart + foldSize;
    if (foldEnd - foldStart < 10) continue; // too small a slice to mean anything

    const testStart = Math.max(foldStart + 1, Math.floor(foldEnd - (foldEnd - foldStart) * testFraction));
    // simulateTrades needs a real startIndex into the *whole* candle array
    // (indicators need history before it), but must not open/close trades
    // before `testStart` — so run it over the fold's full range and then
    // filter to trades whose entry fell inside the test window.
    const foldResult = simulateTrades(candles.slice(0, foldEnd), definition.risk, entryAt, exitAt, Math.max(1, foldStart), { explainEntryAt });
    const testTrades = foldResult.trades.filter((t) => t.entryIndex >= testStart);
    const testEquity = foldResult.equityCurve.filter((_, idx) => idx + Math.max(1, foldStart) >= testStart);
    const maxDrawdown = computeMaxDrawdown(testEquity.length > 0 ? testEquity : foldResult.equityCurve);

    results.push({
      trainFrom: foldStart,
      trainTo: testStart - 1,
      testFrom: testStart,
      testTo: foldEnd - 1,
      testResult: {
        candles: candles.slice(testStart, foldEnd),
        trades: testTrades,
        equityCurve: testEquity,
        stats: buildStats(testTrades, definition.risk, maxDrawdown, testEquity),
        openPosition: null,
      },
    });
  }

  const allTestTrades = results.flatMap((r) => r.testResult.trades);
  const allTestEquity = results.flatMap((r) => r.testResult.equityCurve);
  const combinedMaxDrawdown = Math.max(0, ...results.map((r) => r.testResult.stats.maxDrawdownPercent), 0);

  return {
    folds: results,
    combinedTestStats: buildStats(allTestTrades, definition.risk, combinedMaxDrawdown, allTestEquity),
  };
}

function computeMaxDrawdown(equityCurve: EquityPoint[]): number {
  let peak = equityCurve[0]?.equity ?? 0;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - point.equity) / peak) * 100);
  }
  return maxDrawdown;
}

// ─────────────────────────── Monte Carlo ───────────────────────────

export interface MonteCarloResult {
  runs: number;
  /** Final equity across all shuffles, sorted, so the UI can read off any percentile it wants. */
  finalEquityPercentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  maxDrawdownPercentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  /** Share of shuffles that ended below starting capital — a rough "how often does this go wrong" number the raw stats don't show. */
  probabilityOfLoss: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Bootstraps the *order* of already-computed trade P&Ls — not the trades
 * themselves — to see how sensitive the result is to "what if the winners
 * and losers had landed in a different sequence" (the classic overfitting
 * tell: a strategy whose result depends heavily on one early lucky streak).
 * This deliberately reuses `result.trades` from a real run rather than
 * generating new data, so it's a property of the *trades this strategy
 * actually produced*, not a fresh simulation — the design doc's "full
 * parameter surface, not simply the best parameter set" principle applied
 * to trade sequencing instead of parameters.
 */
export function runMonteCarlo(result: BacktestResult, risk: StrategyDefinition['risk'], runs = 500): MonteCarloResult {
  const pnls = result.trades.map((t) => t.pnl);
  if (pnls.length === 0) {
    return {
      runs: 0,
      finalEquityPercentiles: { p5: risk.capitalAllocated, p25: risk.capitalAllocated, p50: risk.capitalAllocated, p75: risk.capitalAllocated, p95: risk.capitalAllocated },
      maxDrawdownPercentiles: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
      probabilityOfLoss: 0,
    };
  }

  const finalEquities: number[] = [];
  const maxDrawdowns: number[] = [];

  for (let run = 0; run < runs; run++) {
    const shuffled = [...pnls];
    // Fisher–Yates
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let capital = risk.capitalAllocated;
    let peak = capital;
    let maxDrawdown = 0;
    for (const pnl of shuffled) {
      capital += pnl;
      peak = Math.max(peak, capital);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - capital) / peak) * 100);
    }
    finalEquities.push(capital);
    maxDrawdowns.push(maxDrawdown);
  }

  finalEquities.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);

  return {
    runs,
    finalEquityPercentiles: {
      p5: percentile(finalEquities, 5),
      p25: percentile(finalEquities, 25),
      p50: percentile(finalEquities, 50),
      p75: percentile(finalEquities, 75),
      p95: percentile(finalEquities, 95),
    },
    maxDrawdownPercentiles: {
      p5: percentile(maxDrawdowns, 5),
      p25: percentile(maxDrawdowns, 25),
      p50: percentile(maxDrawdowns, 50),
      p75: percentile(maxDrawdowns, 75),
      p95: percentile(maxDrawdowns, 95),
    },
    probabilityOfLoss: finalEquities.filter((e) => e < risk.capitalAllocated).length / runs,
  };
}