import { Candle } from '../../brokers/adapters/brokerAdapter.interface';
import { StrategyDefinition } from '../dsl/types';
import { executeStrategy } from '../sandbox/sandboxService.client';
import { ApiError } from '../../../utils/ApiError';
import { BacktestResult, simulateTrades } from './backtestEngine';

/**
 * Runs a custom Python strategy's on_bar() once per bar over the whole
 * candle range (mode: "backtest" — see sandbox-service's worker.py, which
 * loops internally rather than this making one call per bar) and replays
 * the resulting buy/sell/exit signals through the exact same
 * risk-management simulation (`simulateTrades`) the DSL engine uses — so
 * stop loss, target, trailing stop, time-based exit, and position sizing
 * behave identically whether the entry/exit decision came from the
 * drag-and-drop builder or from user-written Python.
 *
 * `warmup` should be set high enough that the strategy's own indicators
 * (e.g. `ctx.sma(50)`) have enough history to return real numbers instead
 * of None on the first bar it's actually asked to decide on — the sandbox
 * still calls on_bar() for earlier bars too (so `ctx.state` accumulates
 * correctly), it just won't be found in `signals` unless it explicitly
 * returns one.
 */
export async function runPythonBacktest(
  pythonCode: string,
  definition: Pick<StrategyDefinition, 'risk'>,
  candles: Candle[],
  params: Record<string, unknown> = {},
  warmup = 1,
): Promise<BacktestResult & { logs: string[] }> {
  const result = await executeStrategy({
    code: pythonCode,
    bars: candles.map((c) => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
    mode: 'backtest',
    params,
    warmup,
  });

  if (!result.ok) {
    throw ApiError.badRequest(`Strategy code failed during backtest: ${result.error}`, { traceback: result.traceback });
  }

  // The sandbox only knows "buy"/"sell"/"exit" per bar — it has no concept
  // of stop loss/target/trailing/time-exit or capital, all of which live in
  // the strategy's `risk` config the same way they do for DSL strategies.
  // Build simple per-index entry/exit lookups from the sparse signal list
  // and hand off to the shared simulator for everything risk-related.
  const entryTimestamps = new Set(result.signals.filter((s) => s.action === 'buy').map((s) => s.timestamp));
  const exitTimestamps = new Set(result.signals.filter((s) => s.action === 'sell' || s.action === 'exit').map((s) => s.timestamp));

  const simulated = simulateTrades(
    candles,
    definition.risk,
    (i) => entryTimestamps.has(candles[i].timestamp),
    (i) => exitTimestamps.has(candles[i].timestamp),
    Math.max(1, warmup),
  );

  return { ...simulated, logs: result.logs };
}
