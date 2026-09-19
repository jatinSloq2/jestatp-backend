import { Strategy, StrategyRuntimeState, StrategyTrade } from '../../../models';
import { getHistoricalCandles } from '../../brokers/broker.service';
import { executeStrategy } from '../sandbox/sandboxService.client';
import { ConditionEvaluator } from '../backtest/conditionEvaluator';
import { simulateTrades, BacktestTrade } from '../backtest/backtestEngine';
import { logger } from '../../../utils/logger';

const INTRADAY_LOOKBACK_DAYS = 10;
const DAILY_LOOKBACK_DAYS = 300;
const INTRADAY_TIMEFRAMES = new Set(['1m', '3m', '5m', '15m', '30m', '1h']);
// Bars required before the engine trusts an entry/exit decision (so e.g. a
// python strategy calling ctx.sma(50) isn't asked to decide before bar 50
// exists). A fixed, generous constant rather than something per-strategy —
// see the TODO in the strategy builder for exposing this as a per-strategy setting.
const DEFAULT_WARMUP = 50;

/**
 * Runs exactly one execution tick for one `active` strategy: fetches fresh
 * candles, figures out where entry/exit signals come from (DSL condition
 * blocks or a Python sandbox run — same "backtest mode" call whether it's
 * actually backtesting or not, since the return shape either way is just
 * "here are all buy/sell/exit signals in this window"), replays them
 * through `simulateTrades` with `forceCloseAtEnd: false` so a position
 * that's still open going into the next tick stays open instead of being
 * artificially closed, and reconciles the result against the strategy's
 * persisted `StrategyRuntimeState`.
 *
 * Design note: this re-evaluates the WHOLE lookback window on every tick
 * rather than hand-rolling a "step one bar forward" function. That's
 * deliberately simpler and self-healing — if a tick is missed (worker
 * restart, broker hiccup), the next tick just sees a slightly longer new-bar
 * gap and catches up correctly — at the cost of doing more work per tick
 * than a true incremental engine would. Fine at today's strategy counts;
 * worth revisiting if per-tick latency becomes a problem at scale.
 */
export async function runStrategyTick(strategy: Strategy): Promise<void> {
  if (strategy.status !== 'active') return;

  const [runtimeState] = await StrategyRuntimeState.findOrCreate({
    where: { strategyId: strategy.id },
    defaults: { strategyId: strategy.id },
  });

  const lookbackDays = INTRADAY_TIMEFRAMES.has(strategy.timeframe) ? INTRADAY_LOOKBACK_DAYS : DAILY_LOOKBACK_DAYS;
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const candles = await getHistoricalCandles(strategy.userId, strategy.broker, {
    tradingSymbol: strategy.instrument,
    exchange: strategy.exchange,
    segment: strategy.segment,
    timeframe: strategy.timeframe,
    from,
    to,
  });

  if (candles.length < 2) {
    logger.warn(`Strategy ${strategy.id}: not enough candles returned (${candles.length}) — skipping this tick`);
    return;
  }

  const latestBar = candles[candles.length - 1];
  if (runtimeState.lastProcessedBarTimestamp !== null && latestBar.timestamp <= runtimeState.lastProcessedBarTimestamp) {
    return; // no new closed bar since last tick — nothing to do
  }

  const warmup = Math.min(DEFAULT_WARMUP, Math.max(1, candles.length - 1));

  let entrySignalAt: (i: number) => boolean;
  let exitSignalAt: (i: number) => boolean;
  let newPythonState = runtimeState.pythonState;

  if (strategy.language === 'python') {
    const result = await executeStrategy({
      code: strategy.pythonCode!,
      bars: candles.map((c) => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
      mode: 'backtest',
      state: runtimeState.pythonState,
      warmup,
    });

    if (!result.ok) {
      logger.error(`Strategy ${strategy.id} (python): sandbox execution failed — ${result.error}`);
      return; // leave runtime state untouched so the next tick retries from the same point rather than silently skipping a bar
    }
    newPythonState = result.state;
    const entryTimestamps = new Set(result.signals.filter((s) => s.action === 'buy').map((s) => s.timestamp));
    const exitTimestamps = new Set(result.signals.filter((s) => s.action === 'sell' || s.action === 'exit').map((s) => s.timestamp));
    entrySignalAt = (i) => entryTimestamps.has(candles[i].timestamp);
    exitSignalAt = (i) => exitTimestamps.has(candles[i].timestamp);
  } else {
    const evaluator = new ConditionEvaluator(candles);
    const definition = strategy.toStrategyDefinition();
    entrySignalAt = (i) => evaluator.evaluateBlock(definition.entry.conditions, definition.entry.logic, i);
    exitSignalAt = (i) => evaluator.evaluateBlock(definition.exit.conditions, definition.exit.logic, i);
  }

  const simulated = simulateTrades(candles, strategy.riskConfig, entrySignalAt, exitSignalAt, warmup, { forceCloseAtEnd: false });

  // Only act on trades that touch a bar newer than what we've already
  // processed — everything else in `simulated.trades` is history the
  // strategy would have generated on THIS SAME window even if nothing new
  // happened (simulateTrades always replays the full window, see the
  // design note above), so filtering by timestamp is what keeps a tick
  // idempotent instead of re-logging the same trade every time it runs.
  const newTrades = simulated.trades.filter((t) => t.entryTimestamp > (runtimeState.lastProcessedBarTimestamp ?? -Infinity));

  for (const trade of newTrades) {
    await recordTrade(strategy, trade);
  }

  // A position that just opened on this tick and is still open at the end
  // of the window (i.e. simulateTrades' openPosition) also needs recording
  // as a fresh entry if we haven't already logged it via newTrades above.
  if (
    simulated.openPosition &&
    simulated.openPosition.entryTimestamp > (runtimeState.lastProcessedBarTimestamp ?? -Infinity) &&
    !runtimeState.openPosition
  ) {
    await recordEntry(strategy, simulated.openPosition.entryTimestamp, simulated.openPosition.entryPrice, simulated.openPosition.quantity);
  }

  await runtimeState.update({
    lastProcessedBarTimestamp: latestBar.timestamp,
    openPosition: simulated.openPosition,
    pythonState: newPythonState,
  });
}

async function recordEntry(strategy: Strategy, entryTimestamp: number, entryPrice: number, quantity: number): Promise<void> {
  if (strategy.executionMode === 'live') {
    // Real order placement (broker.adapter.placeOrder + an Order row +
    // idempotency/retry/reconciliation handling) is intentionally NOT wired
    // up yet — this codebase's orders module is currently read-only (syncs
    // orders FROM the broker, never places them). Placing real orders off
    // an automated loop without that machinery would be actively unsafe, so
    // this logs loudly and records nothing rather than pretending to trade.
    logger.error(
      `Strategy ${strategy.id} (${strategy.name}) is set to execution_mode=live and would have ENTERED ` +
        `${quantity} @ ${entryPrice} just now, but live order placement is not implemented yet — no order was placed. ` +
        `Switch the strategy to paper mode until this is built.`,
    );
    return;
  }

  await StrategyTrade.create({
    strategyId: strategy.id,
    userId: strategy.userId,
    mode: 'paper',
    entryTimestamp,
    entryPrice,
    quantity,
  });
  logger.info(`Strategy ${strategy.id} (${strategy.name}) [paper]: ENTERED ${quantity} @ ${entryPrice}`);
}

async function recordTrade(strategy: Strategy, trade: BacktestTrade): Promise<void> {
  if (strategy.executionMode === 'live') {
    logger.error(
      `Strategy ${strategy.id} (${strategy.name}) is set to execution_mode=live and would have opened+closed a trade ` +
        `(${trade.quantity} @ ${trade.entryPrice} -> ${trade.exitPrice}, ${trade.exitReason}) just now, but live order ` +
        `placement is not implemented yet — no orders were placed. Switch the strategy to paper mode until this is built.`,
    );
    return;
  }

  await StrategyTrade.create({
    strategyId: strategy.id,
    userId: strategy.userId,
    mode: 'paper',
    entryTimestamp: trade.entryTimestamp,
    entryPrice: trade.entryPrice,
    exitTimestamp: trade.exitTimestamp,
    exitPrice: trade.exitPrice,
    quantity: trade.quantity,
    exitReason: trade.exitReason,
    pnl: trade.pnl,
  });
  logger.info(
    `Strategy ${strategy.id} (${strategy.name}) [paper]: ${trade.quantity} @ ${trade.entryPrice} -> ${trade.exitPrice} ` +
      `(${trade.exitReason}), pnl=${trade.pnl.toFixed(2)}`,
  );
}
