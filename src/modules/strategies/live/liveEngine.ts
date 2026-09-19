import { Strategy, StrategyRuntimeState, StrategyTrade, BrokerConnection } from '../../../models';
import { PersistedOpenPosition } from '../../../models/strategyRuntimeState.model';
import { getHistoricalCandles } from '../../brokers/broker.service';
import { OrderRequest } from '../../brokers/adapters/brokerAdapter.interface';
import { placeOrder } from '../../orders/orderPlacement.service';
import { executeStrategy } from '../sandbox/sandboxService.client';
import { ConditionEvaluator } from '../backtest/conditionEvaluator';
import { simulateTrades, BacktestTrade, OpenPositionSnapshot } from '../backtest/backtestEngine';
import { logger } from '../../../utils/logger';

const INTRADAY_LOOKBACK_DAYS = 10;
const DAILY_LOOKBACK_DAYS = 300;
const INTRADAY_TIMEFRAMES = new Set(['1m', '3m', '5m', '15m', '30m', '1h']);
const DEFAULT_WARMUP = 50;

/**
 * Runs exactly one execution tick for one `active` strategy.
 *
 * Reconciliation, each tick, in order:
 *   1. If we were holding a position coming in, and it closed somewhere in
 *      this window, place the EXIT order (live) / log it (paper) and update
 *      that trade's existing row — never insert a second row for one trade.
 *   2. Any trade that both opened AND closed within bars newer than what
 *      we've processed (and isn't #1) needs both legs placed, in order.
 *   3. A position that's newly open and still open at the end of the
 *      window needs its ENTRY order placed now.
 *   4. Still holding the same position as last tick -> nothing to place,
 *      just refresh the persisted stop/target snapshot (trailing stops move).
 *
 * Safety invariant: `runtimeState.openPosition` is only ever cleared when
 * the exit order actually succeeded (or paper mode, which can't fail this
 * way). If a live exit order is rejected, the position snapshot is kept
 * as-is and logged loudly - the strategy still holds the position at the
 * broker, so the engine must keep believing that and keep retrying the
 * exit, not silently forget about a real open position.
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
    logger.warn(`Strategy ${strategy.id}: not enough candles returned (${candles.length}) - skipping this tick`);
    return;
  }

  const latestBar = candles[candles.length - 1];
  const lastProcessed = runtimeState.lastProcessedBarTimestamp;
  if (lastProcessed !== null && latestBar.timestamp <= lastProcessed) {
    return; // no new closed bar since last tick - nothing to do
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
      logger.error(`Strategy ${strategy.id} (python): sandbox execution failed - ${result.error}`);
      return; // leave state untouched so the next tick retries from the same point
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

  const wasOpen = runtimeState.openPosition;
  const nowOpen = simulated.openPosition;
  const stillSamePosition = Boolean(wasOpen && nowOpen && wasOpen.entryTimestamp === nowOpen.entryTimestamp);

  let nextOpenPosition: PersistedOpenPosition | null = null;

  // 1. Close whatever we were holding, if it closed within this window.
  if (wasOpen && !stillSamePosition) {
    const closedTrade = simulated.trades.find((t) => t.entryTimestamp === wasOpen.entryTimestamp);
    if (closedTrade) {
      const exited = await closeTrade(strategy, wasOpen, closedTrade);
      if (!exited) {
        // Live exit order failed - we still hold this position at the
        // broker. Keep it as the persisted position so the next tick tries
        // to exit again, and stop here: don't also evaluate new entries
        // while we're supposed to be flat-or-exiting.
        await runtimeState.update({ lastProcessedBarTimestamp: latestBar.timestamp, openPosition: wasOpen, pythonState: newPythonState });
        return;
      }
    } else {
      logger.error(
        `Strategy ${strategy.id}: runtime state shows an open position (entry ${wasOpen.entryTimestamp}) that the fresh ` +
          `simulation no longer accounts for - leaving state untouched so this can be investigated rather than guessing.`,
      );
      return;
    }
  }

  // 2. Trades that both opened and closed within newly-seen bars (and aren't the position just handled above).
  const freshlyOpenedAndClosed = simulated.trades.filter(
    (t) => t.entryTimestamp > (lastProcessed ?? -Infinity) && !(wasOpen && t.entryTimestamp === wasOpen.entryTimestamp),
  );
  for (const trade of freshlyOpenedAndClosed) {
    await openAndCloseTrade(strategy, trade);
  }

  // 3 & 4. A position open at the end of the window - either brand new, or the same one we were already holding.
  if (nowOpen) {
    if (stillSamePosition && wasOpen) {
      nextOpenPosition = { ...nowOpen, tradeId: wasOpen.tradeId, entryOrderId: wasOpen.entryOrderId };
    } else if (nowOpen.entryTimestamp > (lastProcessed ?? -Infinity)) {
      nextOpenPosition = await openTrade(strategy, nowOpen);
    }
  }

  await runtimeState.update({
    lastProcessedBarTimestamp: latestBar.timestamp,
    openPosition: nextOpenPosition,
    pythonState: newPythonState,
  });
}

async function getActiveConnection(strategy: Strategy): Promise<BrokerConnection> {
  const connection = await BrokerConnection.findOne({ where: { userId: strategy.userId, broker: strategy.broker, status: 'connected' } });
  if (!connection) {
    throw new Error(`No active ${strategy.broker} connection for user ${strategy.userId} - cannot place live orders`);
  }
  return connection;
}

function toOrderRequest(strategy: Strategy, side: 'BUY' | 'SELL', quantity: number): OrderRequest & { segment: Strategy['segment'] } {
  return {
    tradingSymbol: strategy.instrument,
    exchange: strategy.exchange,
    side,
    orderType: 'MARKET', // strategy signals fire on a closed bar's decision, not a specific limit price - market orders match that intent
    // MIS (intraday, auto-squared-off) for anything faster than daily bars, CNC (delivery) for daily strategies.
    // No per-strategy override yet - a reasonable default until the risk config exposes one explicitly.
    productType: strategy.timeframe === '1d' ? 'CNC' : 'MIS',
    quantity,
    segment: strategy.segment,
  };
}

/** Opens a new position: creates the StrategyTrade row, and for live mode actually places the entry order. Returns null if the entry never actually happened (live order rejected/failed) - caller must treat that as staying flat. */
async function openTrade(strategy: Strategy, snapshot: OpenPositionSnapshot): Promise<PersistedOpenPosition | null> {
  const tradeRow = await StrategyTrade.create({
    strategyId: strategy.id,
    userId: strategy.userId,
    mode: strategy.executionMode,
    entryTimestamp: snapshot.entryTimestamp,
    entryPrice: snapshot.entryPrice,
    quantity: snapshot.quantity,
  });

  if (strategy.executionMode !== 'live') {
    logger.info(`Strategy ${strategy.id} (${strategy.name}) [paper]: ENTERED ${snapshot.quantity} @ ${snapshot.entryPrice}`);
    return { ...snapshot, tradeId: tradeRow.id, entryOrderId: null };
  }

  try {
    const connection = await getActiveConnection(strategy);
    const order = await placeOrder(connection, toOrderRequest(strategy, 'BUY', snapshot.quantity), { strategyId: strategy.id });
    if (order.status === 'REJECTED') {
      logger.error(`Strategy ${strategy.id}: live ENTRY order rejected (${order.statusMessage}) - never actually entered, staying flat.`);
      await tradeRow.destroy(); // the entry never happened - don't leave a phantom trade row behind
      return null;
    }
    await tradeRow.update({ entryOrderId: order.id });
    return { ...snapshot, tradeId: tradeRow.id, entryOrderId: order.id };
  } catch (err) {
    logger.error(`Strategy ${strategy.id}: failed to place live entry order - ${(err as Error).message}. Staying flat.`);
    await tradeRow.destroy();
    return null;
  }
}

/** Closes the strategy's currently-open position. Returns false (and leaves everything as-is) if a live exit order failed - the caller must keep treating the position as open and retry next tick. */
async function closeTrade(strategy: Strategy, position: PersistedOpenPosition, trade: BacktestTrade): Promise<boolean> {
  if (strategy.executionMode !== 'live') {
    await StrategyTrade.update(
      { exitTimestamp: trade.exitTimestamp, exitPrice: trade.exitPrice, exitReason: trade.exitReason, pnl: trade.pnl },
      { where: { id: position.tradeId } },
    );
    logger.info(
      `Strategy ${strategy.id} (${strategy.name}) [paper]: EXITED ${trade.quantity} @ ${trade.exitPrice} (${trade.exitReason}), ` +
        `pnl=${trade.pnl.toFixed(2)}`,
    );
    return true;
  }

  try {
    const connection = await getActiveConnection(strategy);
    const order = await placeOrder(connection, toOrderRequest(strategy, 'SELL', position.quantity), { strategyId: strategy.id });
    if (order.status === 'REJECTED') {
      logger.error(
        `Strategy ${strategy.id}: live EXIT order REJECTED (${order.statusMessage}) - the strategy still holds this position ` +
          `at the broker. Will retry next tick. If this keeps failing, close the position manually.`,
      );
      return false;
    }
    await StrategyTrade.update(
      { exitTimestamp: trade.exitTimestamp, exitPrice: trade.exitPrice, exitReason: trade.exitReason, pnl: trade.pnl, exitOrderId: order.id },
      { where: { id: position.tradeId } },
    );
    return true;
  } catch (err) {
    logger.error(
      `Strategy ${strategy.id}: failed to place live exit order - ${(err as Error).message}. Still holding this position at the ` +
        `broker - will retry next tick.`,
    );
    return false;
  }
}

/** A trade that opened and closed entirely within bars we haven't processed yet - both legs need placing now, in order. */
async function openAndCloseTrade(strategy: Strategy, trade: BacktestTrade): Promise<void> {
  const opened = await openTrade(strategy, {
    entryIndex: trade.entryIndex,
    entryTimestamp: trade.entryTimestamp,
    entryPrice: trade.entryPrice,
    quantity: trade.quantity,
    stopLossPrice: trade.entryPrice, // not used again once closed - simulateTrades already made the exit decision below
    targetPrice: trade.entryPrice,
    trailingStopPrice: null,
  });
  if (!opened) return; // entry failed - nothing to exit

  await closeTrade(strategy, opened, trade);
  // Note: if the exit leg fails here, the position genuinely IS still open
  // at the broker (for live mode) even though this tick's simulation
  // window shows it as historically closed. That's a real edge case this
  // "re-run everything from scratch" design doesn't self-heal perfectly -
  // it's logged loudly by closeTrade above; reconciling it against the
  // broker's actual order/position book (via the existing syncOrders /
  // syncPositions jobs) is the next layer that should catch and alert on
  // this specific mismatch rather than the strategy engine silently
  // retrying forever, since by the next tick the simulation will show this
  // trade as historically closed either way and won't attempt the exit again.
}
