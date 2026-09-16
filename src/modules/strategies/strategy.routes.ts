import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { strategyDefinitionSchema, strategyUpdateSchema, strategyValidateSchema } from './dsl/schema';
import {
  activateStrategyHandler,
  archiveStrategyHandler,
  createStrategyHandler,
  duplicateStrategyHandler,
  getIndicatorCatalogHandler,
  getStrategyHandler,
  getVersionHandler,
  listStrategiesHandler,
  listVersionsHandler,
  pauseStrategyHandler,
  updateStrategyHandler,
  validateStrategyHandler,
} from './strategy.controller';
import { backtestPreviewSchema, backtestRequestSchema } from './backtest/backtest.validator';
import { previewBacktestHandler, runBacktestHandler } from './backtest/backtest.controller';

const router = Router();
router.use(requireAuth);

const idParamSchema = Joi.object({ id: Joi.string().uuid().required() });
const versionParamSchema = Joi.object({ id: Joi.string().uuid().required(), version: Joi.number().integer().min(1).required() });
const listQuerySchema = Joi.object({
  status: Joi.string().valid('draft', 'active', 'paused', 'archived').optional(),
  segment: Joi.string().valid('equity', 'fno', 'currency', 'commodity').optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

/**
 * @openapi
 * components:
 *   schemas:
 *     IndicatorRef:
 *       type: object
 *       required: [indicator]
 *       properties:
 *         indicator: { type: string, enum: [SMA, EMA, VWAP, RSI, MACD, BBANDS, SUPERTREND, ATR, ADX, STOCHASTIC] }
 *         params:
 *           type: object
 *           additionalProperties: { type: number }
 *           example: { period: 21 }
 *     Condition:
 *       type: object
 *       description: >
 *         A discriminated union keyed by `type`. One of: indicator, candle_pattern, price_action,
 *         volume, breakout, support_resistance, time, market_condition, custom_formula, or group
 *         (which nests more conditions under AND/OR — arbitrary depth). See
 *         GET /strategies/meta/indicators for the full catalog of legal values.
 *       example:
 *         type: indicator
 *         indicator: EMA
 *         params: { period: 9 }
 *         operator: cross_above
 *         value: { indicator: EMA, params: { period: 21 } }
 *     ConditionBlock:
 *       type: object
 *       required: [conditions]
 *       properties:
 *         conditions:
 *           type: array
 *           items: { $ref: '#/components/schemas/Condition' }
 *         logic: { type: string, enum: [AND, OR], default: AND }
 *     RiskConfig:
 *       type: object
 *       required: [capitalAllocated, maxLossPerDay, maxPositions, maxTradesPerDay, positionSizing, stopLoss, target]
 *       description: Strategy-level limits — mirrors "Strategy Capital / Max loss per day / Max positions / Max trades per day" from the spec.
 *       properties:
 *         capitalAllocated: { type: number, example: 50000 }
 *         maxLossPerDay: { type: number, example: 2000 }
 *         maxPositions: { type: integer, example: 3 }
 *         maxTradesPerDay: { type: integer, example: 10 }
 *         positionSizing:
 *           type: object
 *           properties:
 *             method: { type: string, enum: [fixed_quantity, fixed_capital, percent_of_capital] }
 *             value: { type: number }
 *         stopLoss:
 *           type: object
 *           properties:
 *             type: { type: string, enum: [percent, points] }
 *             value: { type: number, example: 1 }
 *         target:
 *           type: object
 *           properties:
 *             type: { type: string, enum: [percent, points] }
 *             value: { type: number, example: 2 }
 *         trailingStopLoss:
 *           type: object
 *           properties:
 *             enabled: { type: boolean }
 *             type: { type: string, enum: [percent, points] }
 *             value: { type: number }
 *         timeBasedExit:
 *           type: object
 *           properties:
 *             enabled: { type: boolean }
 *             exitTime: { type: string, example: "15:15" }
 *     StrategyInput:
 *       type: object
 *       required: [name, instrument, exchange, timeframe, entry, exit, risk]
 *       properties:
 *         name: { type: string, example: "NIFTY EMA Crossover" }
 *         description: { type: string, nullable: true }
 *         instrument: { type: string, example: "NIFTY" }
 *         exchange: { type: string, example: "NFO" }
 *         segment: { type: string, enum: [equity, fno, currency, commodity], default: equity }
 *         timeframe: { type: string, enum: ["1m","3m","5m","15m","30m","1h","1d"], example: "5m" }
 *         executionMode: { type: string, enum: [paper, live], default: paper }
 *         entry: { $ref: '#/components/schemas/ConditionBlock' }
 *         exit: { $ref: '#/components/schemas/ConditionBlock' }
 *         risk: { $ref: '#/components/schemas/RiskConfig' }
 *         changeNote: { type: string, description: "Optional note stored with this version" }
 *     Strategy:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         userId: { type: string, format: uuid }
 *         name: { type: string }
 *         description: { type: string, nullable: true }
 *         instrument: { type: string }
 *         exchange: { type: string }
 *         segment: { type: string, enum: [equity, fno, currency, commodity] }
 *         timeframe: { type: string }
 *         status: { type: string, enum: [draft, active, paused, archived] }
 *         executionMode: { type: string, enum: [paper, live] }
 *         currentVersion: { type: integer }
 *         entryConditions: { $ref: '#/components/schemas/ConditionBlock' }
 *         exitConditions: { $ref: '#/components/schemas/ConditionBlock' }
 *         riskConfig: { $ref: '#/components/schemas/RiskConfig' }
 *         lastValidatedAt: { type: string, format: date-time, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     ValidationResult:
 *       type: object
 *       properties:
 *         valid: { type: boolean }
 *         issues:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               path: { type: string, example: "entry.conditions[0].value" }
 *               message: { type: string }
 */

/**
 * @openapi
 * /strategies/meta/indicators:
 *   get:
 *     tags: [Strategies]
 *     summary: Get the full DSL catalog (indicators, operators, candle patterns, market conditions, etc.)
 *     description: >
 *       Everything the visual Strategy Builder needs to populate its dropdowns and validate
 *       input client-side before ever calling /strategies/validate. This is the same catalog
 *       the server-side Joi schema and semantic validator enforce.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: DSL catalog }
 */
router.get('/meta/indicators', getIndicatorCatalogHandler);

/**
 * @openapi
 * /strategies/validate:
 *   post:
 *     tags: [Strategies]
 *     summary: Validate a Strategy JSON without saving it (dry run)
 *     description: >
 *       Runs the exact same two-stage validation create/update use — Joi shape validation,
 *       then the semantic Strategy Validator (indicator period ranges, cross-operator operand
 *       types, MACD fast<slow, risk-figure consistency, formula safety) — and returns the
 *       issue list instead of persisting anything. Built for the builder UI's live "Validate"
 *       button as the user assembles conditions.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/StrategyInput' }
 *     responses:
 *       200: { description: Valid — no issues, content: { application/json: { schema: { $ref: '#/components/schemas/ValidationResult' } } } }
 *       422: { description: Invalid — see issues array }
 */
router.post('/validate', validate(strategyValidateSchema), validateStrategyHandler);

/**
 * @openapi
 * /strategies/backtest/preview:
 *   post:
 *     tags: [Strategies]
 *     summary: Run a backtest for a strategy definition that hasn't been saved yet
 *     description: >
 *       Same engine as POST /strategies/{id}/backtest, but takes the full strategy
 *       definition inline instead of an id — used by the strategy builder to show a real
 *       backtest against real historical candles while the user is still editing, before
 *       anything is persisted.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Backtest result (candles, trades, equity curve, stats) }
 *       400: { description: No active broker connection, or not enough historical data }
 */
router.post('/backtest/preview', validate(backtestPreviewSchema), previewBacktestHandler);

/**
 * @openapi
 * /strategies:
 *   post:
 *     tags: [Strategies]
 *     summary: Create a new strategy (starts in `draft` status)
 *     description: >
 *       Converts the Strategy Builder's output into the machine-executable Strategy JSON,
 *       runs it through the Strategy Validator, and persists it as version 1. Nothing runs
 *       yet — call /strategies/{id}/activate when ready.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/StrategyInput' }
 *     responses:
 *       201:
 *         description: Strategy created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Strategy' }
 *       400: { description: Failed strategy validation — see the response's details array }
 */
router.post('/', validate(strategyDefinitionSchema), createStrategyHandler);

/**
 * @openapi
 * /strategies:
 *   get:
 *     tags: [Strategies]
 *     summary: List my strategies (paginated, filterable by status/segment)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, active, paused, archived] }
 *       - in: query
 *         name: segment
 *         schema: { type: string, enum: [equity, fno, currency, commodity] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *     responses:
 *       200:
 *         description: Paginated list of strategies
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Strategy' }
 *                 meta: { $ref: '#/components/schemas/PaginationMeta' }
 */
router.get('/', validate(listQuerySchema, 'query'), listStrategiesHandler);

/**
 * @openapi
 * /strategies/{id}:
 *   get:
 *     tags: [Strategies]
 *     summary: Get a single strategy (its current live definition)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Strategy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Strategy' }
 *       404: { description: Not found }
 */
router.get('/:id', validate(idParamSchema, 'params'), getStrategyHandler);

/**
 * @openapi
 * /strategies/{id}:
 *   patch:
 *     tags: [Strategies]
 *     summary: Update a strategy's definition (creates a new version)
 *     description: >
 *       Any provided field is merged over the current definition, re-validated as a whole,
 *       and — if valid — saved as the next version in strategy_versions (the previous
 *       version is never overwritten). Blocked while the strategy is `active`; pause it first.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/StrategyInput' }
 *     responses:
 *       200:
 *         description: Updated strategy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Strategy' }
 *       400: { description: Currently active, or failed validation }
 */
router.patch('/:id', validate(idParamSchema, 'params'), validate(strategyUpdateSchema), updateStrategyHandler);

/**
 * @openapi
 * /strategies/{id}/activate:
 *   post:
 *     tags: [Strategies]
 *     summary: Activate a strategy — re-validates, then flips status to `active`
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Strategy activated }
 *       400: { description: Validation failed, or strategy is archived }
 */
router.post('/:id/activate', validate(idParamSchema, 'params'), activateStrategyHandler);

/**
 * @openapi
 * /strategies/{id}/pause:
 *   post:
 *     tags: [Strategies]
 *     summary: Pause an active strategy (stops new signals; open positions are unaffected — see the Risk Engine's kill switch for that)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Strategy paused }
 *       400: { description: Strategy was not active }
 */
router.post('/:id/pause', validate(idParamSchema, 'params'), pauseStrategyHandler);

/**
 * @openapi
 * /strategies/{id}:
 *   delete:
 *     tags: [Strategies]
 *     summary: Archive (soft-delete) a strategy
 *     description: Must be paused/draft first. The strategy and its full version history are preserved (soft-deleted), not hard-deleted.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Archived }
 *       400: { description: Strategy is currently active }
 */
router.delete('/:id', validate(idParamSchema, 'params'), archiveStrategyHandler);

/**
 * @openapi
 * /strategies/{id}/duplicate:
 *   post:
 *     tags: [Strategies]
 *     summary: Duplicate a strategy into a brand-new draft (always starts in paper execution mode)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: New draft strategy created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Strategy' }
 */
router.post('/:id/duplicate', validate(idParamSchema, 'params'), duplicateStrategyHandler);

/**
 * @openapi
 * /strategies/{id}/versions:
 *   get:
 *     tags: [Strategies]
 *     summary: List a strategy's full version history (newest first)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Version history }
 */
router.get('/:id/versions', validate(idParamSchema, 'params'), listVersionsHandler);

/**
 * @openapi
 * /strategies/{id}/versions/{version}:
 *   get:
 *     tags: [Strategies]
 *     summary: Get one specific version snapshot (e.g. to re-run an old backtest exactly)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: version
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Version snapshot }
 *       404: { description: Version not found }
 */
router.get('/:id/versions/:version', validate(versionParamSchema, 'params'), getVersionHandler);

/**
 * @openapi
 * /strategies/{id}/backtest:
 *   post:
 *     tags: [Strategies]
 *     summary: Run this strategy's entry/exit conditions against real historical candles
 *     description: >
 *       Fetches OHLCV candles for the strategy's own instrument/exchange/timeframe from the
 *       given connected broker (defaulting to the last 30 days for intraday timeframes, or
 *       the last year for daily), replays the strategy's actual DSL conditions bar-by-bar,
 *       and returns the resulting trades, equity curve, and summary stats. This is real
 *       simulated execution against real market data — not a random/illustrative preview.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [broker]
 *             properties:
 *               broker: { type: string, enum: [dhan, zerodha, groww] }
 *               from: { type: string, format: date-time }
 *               to: { type: string, format: date-time }
 *     responses:
 *       200: { description: Backtest result (candles, trades, equity curve, stats) }
 *       400: { description: No active broker connection, or not enough historical data }
 */
router.post('/:id/backtest', validate(idParamSchema, 'params'), validate(backtestRequestSchema), runBacktestHandler);

export default router;