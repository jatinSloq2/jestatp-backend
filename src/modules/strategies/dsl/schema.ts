import Joi from 'joi';
import {
  ALL_OPERATORS,
  BREAKOUT_LEVELS,
  CANDLE_PATTERNS,
  INDICATOR_NAMES,
  MARKET_CONDITIONS,
  POSITION_SIZING_METHODS,
  PRICE_FIELDS,
  STOP_LOSS_TARGET_TYPES,
  TIMEFRAMES,
} from './constants';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const timeString = () => Joi.string().pattern(HHMM).messages({ 'string.pattern.base': 'Time must be in 24h "HH:mm" format' });

const indicatorParams = Joi.object().pattern(Joi.string(), Joi.number()).max(6);

const indicatorRef = Joi.object({
  indicator: Joi.string()
    .valid(...INDICATOR_NAMES)
    .required(),
  params: indicatorParams.optional(),
});

/** Right-hand side of a condition: a plain number, a [min,max] range (for `between`), or another indicator series. */
const conditionOperand = Joi.alternatives().try(
  Joi.number(),
  Joi.array().items(Joi.number()).length(2),
  indicatorRef,
);

const indicatorCondition = Joi.object({
  type: Joi.string().valid('indicator').required(),
  indicator: Joi.string()
    .valid(...INDICATOR_NAMES)
    .required(),
  params: indicatorParams.optional(),
  operator: Joi.string()
    .valid(...ALL_OPERATORS)
    .required(),
  value: conditionOperand.required(),
});

const candlePatternCondition = Joi.object({
  type: Joi.string().valid('candle_pattern').required(),
  pattern: Joi.string()
    .valid(...CANDLE_PATTERNS)
    .required(),
  lookback: Joi.number().integer().min(1).max(20).optional(),
});

const priceActionCondition = Joi.object({
  type: Joi.string().valid('price_action').required(),
  field: Joi.string()
    .valid(...PRICE_FIELDS)
    .required(),
  operator: Joi.string()
    .valid(...ALL_OPERATORS)
    .required(),
  value: conditionOperand.required(),
});

const volumeCondition = Joi.object({
  type: Joi.string().valid('volume').required(),
  operator: Joi.string()
    .valid(...ALL_OPERATORS)
    .required(),
  compareTo: Joi.alternatives()
    .try(
      Joi.number(),
      Joi.object({
        type: Joi.string().valid('average_volume').required(),
        period: Joi.number().integer().min(2).max(500).required(),
      }),
    )
    .required(),
});

const breakoutCondition = Joi.object({
  type: Joi.string().valid('breakout').required(),
  level: Joi.string()
    .valid(...BREAKOUT_LEVELS)
    .required(),
  lookbackPeriod: Joi.number().integer().min(2).max(500).required(),
  bufferPercent: Joi.number().min(0).max(10).optional(),
});

const supportResistanceCondition = Joi.object({
  type: Joi.string().valid('support_resistance').required(),
  level: Joi.string().valid('support', 'resistance').required(),
  proximityPercent: Joi.number().min(0).max(10).required(),
});

const timeCondition = Joi.object({
  type: Joi.string().valid('time').required(),
  operator: Joi.string().valid('before', 'after', 'between').required(),
  value: Joi.alternatives().conditional('operator', {
    is: 'between',
    then: Joi.array().items(timeString().required()).length(2).required(),
    otherwise: timeString().required(),
  }),
});

const marketConditionCondition = Joi.object({
  type: Joi.string().valid('market_condition').required(),
  condition: Joi.string()
    .valid(...MARKET_CONDITIONS)
    .required(),
});

const customFormulaCondition = Joi.object({
  type: Joi.string().valid('custom_formula').required(),
  formula: Joi.string()
    .min(1)
    .max(500)
    .pattern(/^[a-zA-Z0-9_()\.\+\-\*/><=!,\s]+$/)
    .required()
    .messages({ 'string.pattern.base': 'Formula contains unsupported characters' }),
});

/**
 * Recursive condition schema: a leaf condition, OR a `group` node whose
 * `conditions` array can itself contain more leaves or nested groups.
 * `Joi.link('#condition')` is how Joi expresses "refer back to the schema
 * with this id", which is what makes AND/OR nesting of arbitrary depth work.
 */
export const conditionSchema: Joi.AlternativesSchema = Joi.alternatives()
  .id('condition')
  .try(
    indicatorCondition,
    candlePatternCondition,
    priceActionCondition,
    volumeCondition,
    breakoutCondition,
    supportResistanceCondition,
    timeCondition,
    marketConditionCondition,
    customFormulaCondition,
    Joi.object({
      type: Joi.string().valid('group').required(),
      operator: Joi.string().valid('AND', 'OR').required(),
      conditions: Joi.array().items(Joi.link('#condition')).min(1).max(20).required(),
    }),
  );

const conditionBlock = Joi.object({
  conditions: Joi.array().items(conditionSchema).min(1).max(20).required(),
  logic: Joi.string().valid('AND', 'OR').default('AND'),
});

const positionSizing = Joi.object({
  method: Joi.string()
    .valid(...POSITION_SIZING_METHODS)
    .required(),
  value: Joi.number().positive().required(),
});

const stopLossOrTarget = Joi.object({
  type: Joi.string()
    .valid(...STOP_LOSS_TARGET_TYPES)
    .required(),
  value: Joi.number().positive().required(),
});

const trailingStopLoss = Joi.object({
  enabled: Joi.boolean().required(),
  type: Joi.string()
    .valid(...STOP_LOSS_TARGET_TYPES)
    .required(),
  value: Joi.number().positive().required(),
});

const timeBasedExit = Joi.object({
  enabled: Joi.boolean().required(),
  exitTime: timeString().required(),
});

export const riskConfigSchema = Joi.object({
  capitalAllocated: Joi.number().positive().max(100_000_000).required(),
  maxLossPerDay: Joi.number().positive().required(),
  maxPositions: Joi.number().integer().min(1).max(50).required(),
  maxTradesPerDay: Joi.number().integer().min(1).max(500).required(),
  positionSizing: positionSizing.required(),
  stopLoss: stopLossOrTarget.required(),
  target: stopLossOrTarget.required(),
  trailingStopLoss: trailingStopLoss.optional(),
  timeBasedExit: timeBasedExit.optional(),
});

/** The full payload accepted by POST/PATCH /strategies. */
export const strategyDefinitionSchema = Joi.object({
  name: Joi.string().min(2).max(150).required(),
  description: Joi.string().max(1000).allow('', null).optional(),
  instrument: Joi.string().min(1).max(60).required(),
  exchange: Joi.string().min(1).max(10).uppercase().required(),
  segment: Joi.string().valid('equity', 'fno', 'currency', 'commodity').optional(),
  timeframe: Joi.string()
    .valid(...TIMEFRAMES)
    .required(),
  broker: Joi.string().valid('dhan', 'zerodha', 'groww').required(),
  executionMode: Joi.string().valid('paper', 'live').optional(),
  language: Joi.string().valid('dsl', 'python').default('dsl'),
  // Whether entry/exit vs. pythonCode is actually required depends on
  // `language`, and that rule needs to behave differently for POST (full
  // payload) vs PATCH (partial update, see strategyUpdateSchema below) — so
  // it's enforced once, uniformly, in strategy.service.ts rather than here.
  // Postgres's chk_strategies_language_payload CHECK is the final backstop.
  entry: conditionBlock.optional(),
  exit: conditionBlock.optional(),
  pythonCode: Joi.string().min(1).max(20_000).optional(),
  risk: riskConfigSchema.required(),
  changeNote: Joi.string().max(255).allow('', null).optional(),
});

/** Same shape but every field optional — used for PATCH (partial update). */
export const strategyUpdateSchema = strategyDefinitionSchema.fork(
  ['name', 'instrument', 'exchange', 'timeframe', 'broker', 'risk'],
  (s) => s.optional(),
);

/** Used by POST /strategies/validate — same body shape as create, dry-run only. */
export const strategyValidateSchema = strategyDefinitionSchema;
