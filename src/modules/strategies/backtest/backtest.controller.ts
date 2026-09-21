import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { AuthenticatedRequest } from '../../../middlewares/auth.middleware';
import { BrokerName } from '../../../models/brokerConnection.model';
import { getStrategy } from '../strategy.service';
import { getHistoricalCandles } from '../../brokers/broker.service';
import { runBacktest, runMonteCarlo, runWalkForward } from './backtestEngine';
import { runPythonBacktest } from './pythonBacktestEngine';

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
  const broker = (req.body.broker as BrokerName | undefined) ?? strategy.broker;
  const { from, to } = resolveDateRange(strategy.timeframe, req.body.from, req.body.to);
  const mode: 'standard' | 'walk_forward' | 'monte_carlo' = req.body.mode ?? 'standard';

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

  const definition = strategy.toStrategyDefinition();
  const envelope = {
    strategyId: strategy.id,
    broker,
    timeframe: strategy.timeframe,
    instrument: strategy.instrument,
    exchange: strategy.exchange,
    from: from.toISOString(),
    to: to.toISOString(),
    mode,
  };

  if (mode === 'walk_forward') {
    if (strategy.language === 'python') {
      throw ApiError.badRequest('Walk-forward testing is only available for rule-builder (DSL) strategies right now, not Python strategies.');
    }
    const walkForward = runWalkForward(definition, candles, req.body.folds ?? 3, req.body.testFraction ?? 0.3);
    return res.json({ success: true, data: { ...envelope, walkForward } });
  }

  if (mode === 'monte_carlo') {
    const base =
      strategy.language === 'python'
        ? await runPythonBacktest(strategy.pythonCode!, definition, candles, req.body.params ?? {}, req.body.warmup ?? 20, req.user!.id)
        : runBacktest(definition, candles);
    const monteCarlo = runMonteCarlo(base, definition.risk, req.body.runs ?? 500);
    return res.json({ success: true, data: { ...envelope, ...base, monteCarlo } });
  }

  const result =
    strategy.language === 'python'
      ? await runPythonBacktest(
          strategy.pythonCode!,
          definition,
          candles,
          req.body.params ?? {},
          req.body.warmup ?? 20,
          req.user!.id,
        )
      : runBacktest(definition, candles);

  res.json({ success: true, data: { ...envelope, ...result } });
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
  const language: 'dsl' | 'python' = req.body.language ?? 'dsl';
  const timeframe = req.body.timeframe;
  const { from, to } = resolveDateRange(timeframe, req.body.from, req.body.to);

  const candles = await getHistoricalCandles(req.user!.id, broker, {
    tradingSymbol: req.body.instrument,
    exchange: req.body.exchange,
    segment: req.body.segment,
    timeframe,
    from,
    to,
  });

  if (candles.length < 5) {
    throw ApiError.badRequest(
      `Not enough historical data returned for ${req.body.instrument} on ${req.body.exchange} (${timeframe}) in this date range.`,
    );
  }

  const result =
    language === 'python'
      ? await runPythonBacktest(req.body.pythonCode, { risk: req.body.risk }, candles, req.body.params ?? {}, req.body.warmup ?? 20, req.user!.id)
      : runBacktest(
          {
            instrument: req.body.instrument,
            exchange: req.body.exchange,
            timeframe,
            entry: req.body.entry,
            exit: req.body.exit,
            risk: req.body.risk,
          },
          candles,
        );

  res.json({
    success: true,
    data: {
      broker,
      timeframe,
      instrument: req.body.instrument,
      exchange: req.body.exchange,
      from: from.toISOString(),
      to: to.toISOString(),
      ...result,
    },
  });
});