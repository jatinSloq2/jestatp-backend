import Joi from 'joi';
import { strategyDefinitionSchema } from '../dsl/schema';

export const backtestRequestSchema = Joi.object({
  broker: Joi.string().valid('dhan', 'zerodha', 'groww').required(),
  from: Joi.string().isoDate().optional(),
  to: Joi.string().isoDate().optional(),
});

/**
 * Same as backtestRequestSchema, plus the full strategy definition inline —
 * used by the strategy builder to preview a backtest against real market
 * data *before* the strategy has been saved (so there's no :id yet to
 * re-run POST /strategies/:id/backtest against).
 */
export const backtestPreviewSchema = strategyDefinitionSchema.fork(['name'], (s) => s.optional()).concat(
  Joi.object({
    broker: Joi.string().valid('dhan', 'zerodha', 'groww').required(),
    from: Joi.string().isoDate().optional(),
    to: Joi.string().isoDate().optional(),
  }),
);