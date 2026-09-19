import { Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { parsePagination } from '../../utils/pagination';
import * as strategyService from './strategy.service';
import { getStrategyActivity } from './strategyActivity.service';
import { StrategyStatus } from './dsl/constants';
import { INDICATOR_NAMES, INDICATOR_PARAM_SPECS, CANDLE_PATTERNS, MARKET_CONDITIONS, ALL_OPERATORS, BREAKOUT_LEVELS, TIMEFRAMES, POSITION_SIZING_METHODS, STOP_LOSS_TARGET_TYPES } from './dsl/constants';

export const createStrategyHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const strategy = await strategyService.createStrategy(req.user!.id, req.body);
  res.status(201).json({ success: true, data: strategy });
});

export const listStrategiesHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const pagination = parsePagination(req.query);
  const status = req.query.status as StrategyStatus | undefined;
  const segment = req.query.segment as string | undefined;
  const { rows, meta } = await strategyService.listStrategies(req.user!.id, pagination, { status, segment });
  res.json({ success: true, data: rows, meta });
});

export const getStrategyHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const strategy = await strategyService.getStrategy(req.user!.id, req.params.id);
  res.json({ success: true, data: strategy });
});

export const updateStrategyHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const strategy = await strategyService.updateStrategy(req.user!.id, req.params.id, req.body);
  res.json({ success: true, data: strategy });
});

export const activateStrategyHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const strategy = await strategyService.activateStrategy(req.user!.id, req.params.id);
  res.json({ success: true, data: strategy });
});

export const pauseStrategyHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const strategy = await strategyService.pauseStrategy(req.user!.id, req.params.id);
  res.json({ success: true, data: strategy });
});

export const archiveStrategyHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await strategyService.archiveStrategy(req.user!.id, req.params.id);
  res.json({ success: true, data: result });
});

export const duplicateStrategyHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const strategy = await strategyService.duplicateStrategy(req.user!.id, req.params.id);
  res.status(201).json({ success: true, data: strategy });
});

export const listVersionsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const versions = await strategyService.listVersions(req.user!.id, req.params.id);
  res.json({ success: true, data: versions });
});

export const getVersionHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const version = await strategyService.getVersion(req.user!.id, req.params.id, Number(req.params.version));
  res.json({ success: true, data: version });
});

export const validateStrategyHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await strategyService.validateDefinitionOnly(req.body);
  res.status(result.valid ? 200 : 422).json({ success: result.valid, data: result });
});

export const getIndicatorCatalogHandler = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      indicators: INDICATOR_NAMES.map((name) => ({ name, ...INDICATOR_PARAM_SPECS[name] })),
      operators: ALL_OPERATORS,
      candlePatterns: CANDLE_PATTERNS,
      marketConditions: MARKET_CONDITIONS,
      breakoutLevels: BREAKOUT_LEVELS,
      timeframes: TIMEFRAMES,
      positionSizingMethods: POSITION_SIZING_METHODS,
      stopLossTargetTypes: STOP_LOSS_TARGET_TYPES,
    },
  });
});

export const getStrategyActivityHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const pagination = parsePagination(req.query);
  const activity = await getStrategyActivity(req.user!.id, req.params.id, pagination);
  res.json({ success: true, data: activity });
});
