import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { AuthenticatedRequest } from '../../../middlewares/auth.middleware';
import { BrokerName } from '../../../models/brokerConnection.model';
import { getStrategy } from '../strategy.service';
import { StrategyDefinition } from '../dsl/types';
import { getHistoricalCandles } from '../../brokers/broker.service';
import { runBacktest } from './backtestEngine';

const DAY_MS = 24 * 60 * 60 * 1000;
const INTRADAY_TIMEFRAMES = new Set(['1m', '3m', '5m', '15m', '30m', '1h']);
/** Conservative default/max lookback windows — real brokers cap intraday history much lower than daily. */
const DEFAULT_INTRADAY_DAYS = 30;
const MAX_INTRADAY_DAYS = 60;
const DEFAULT_DAILY_DAYS = 365;
const MAX_DAILY_DAYS = 365 * 5;

function resolveDateRange(timeframe: string, fromInput?: string, toInput?: string): { from: Date; to: Date } {
  const to = toInput ? new Date(toInput) : new Date();
  const isIntraday = INTRADAY_TIMEFRAMES.has(timeframe);
  const defaultDays = isIntraday ? DEFAULT_INTRADAY_DAYS : DEFAULT_DAILY_DAYS;
  const maxDays = isIntraday ? MAX_INTRADAY_DAYS : MAX_DAILY_DAYS;

  let from = fromInput ? new Date(fromInput) : new Date(to.getTime() - defaultDays * DAY_MS);

  if (to.getTime() - from.getTime() > maxDays * DAY_MS) {
    from = new Date(to.getTime() - maxDays * DAY_MS);
  }
  if (from.getTime() >= to.getTime()) {
    throw ApiError.badRequest('`from` must be before `to`');
  }
  return { from, to };
}

/**
 * POST /strategies/:id/backtest — replays the strategy's own entry/exit
 * conditions against real historical candles for its configured
 * instrument/exchange/timeframe, fetched live from the user's connected
 * broker. This is what both the strategy builder's chart preview and a
 * dedicated "run backtest" action call — there's no synthetic/random data
 * path left in the backend.
 */
export const runBacktestHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const strategy = await getStrategy(req.user!.id, req.params.id);
  const broker = req.body.broker as BrokerName;
  const { from, to } = resolveDateRange(strategy.timeframe, req.body.from, req.body.to);

  const candles = await getHistoricalCandles(req.user!.id, broker, {
    tradingSymbol: strategy.instrument,
    exchange: strategy.exchange,
    segment: strategy.segment,
    timeframe: strategy.timeframe,
    from,
    to,
  });

  if (candles.length < 5) {
    throw ApiError.badRequest(
      `Not enough historical data returned for ${strategy.instrument} on ${strategy.exchange} (${strategy.timeframe}) in this date range. Try a wider range or check the instrument/exchange on the strategy.`,
    );
  }

  const result = runBacktest(strategy.toStrategyDefinition(), candles);

  res.json({
    success: true,
    data: {
      strategyId: strategy.id,
      broker,
      timeframe: strategy.timeframe,
      instrument: strategy.instrument,
      exchange: strategy.exchange,
      from: from.toISOString(),
      to: to.toISOString(),
      ...result,
    },
  });
});

/**
 * POST /strategies/backtest/preview — same engine, but for a strategy
 * definition that hasn't been saved yet (the builder's live chart preview
 * while a user is still editing entry/exit conditions). Nothing is
 * persisted or ownership-checked beyond "does this user have the given
 * broker connected".
 */
export const previewBacktestHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const broker = req.body.broker as BrokerName;
  const definition: StrategyDefinition = {
    instrument: req.body.instrument,
    exchange: req.body.exchange,
    timeframe: req.body.timeframe,
    entry: req.body.entry,
    exit: req.body.exit,
    risk: req.body.risk,
  };
  const { from, to } = resolveDateRange(definition.timeframe, req.body.from, req.body.to);

  const candles = await getHistoricalCandles(req.user!.id, broker, {
    tradingSymbol: definition.instrument,
    exchange: definition.exchange,
    segment: req.body.segment,
    timeframe: definition.timeframe,
    from,
    to,
  });

  if (candles.length < 5) {
    throw ApiError.badRequest(
      `Not enough historical data returned for ${definition.instrument} on ${definition.exchange} (${definition.timeframe}) in this date range.`,
    );
  }

  const result = runBacktest(definition, candles);

  res.json({
    success: true,
    data: {
      broker,
      timeframe: definition.timeframe,
      instrument: definition.instrument,
      exchange: definition.exchange,
      from: from.toISOString(),
      to: to.toISOString(),
      ...result,
    },
  });
});