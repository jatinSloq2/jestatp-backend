import Joi from 'joi';
import { strategyDefinitionSchema } from '../dsl/schema';

export const backtestRequestSchema = Joi.object({
  broker: Joi.string().valid('dhan', 'zerodha', 'groww').optional(), // defaults to the strategy's own `broker` field if omitted
  from: Joi.string().isoDate().optional(),
  to: Joi.string().isoDate().optional(),
  // Python-strategy-only: extra inputs passed through to on_bar(ctx.params),
  // and how many leading bars to require before the first real decision
  // (e.g. a strategy using sma(50) needs warmup >= 50). Ignored for DSL strategies.
  params: Joi.object().optional(),
  warmup: Joi.number().integer().min(1).max(500).optional(),
  // 'standard' (default) is a normal single-pass backtest. 'walk_forward'
  // (DSL strategies only, see backtestEngine.ts's runWalkForward) splits the
  // range into consecutive train/test folds. 'monte_carlo' runs a normal
  // backtest first, then reshuffles its trade order `runs` times to show a
  // distribution of outcomes rather than one number.
  mode: Joi.string().valid('standard', 'walk_forward', 'monte_carlo').optional(),
  folds: Joi.number().integer().min(2).max(10).optional(), // walk_forward only
  testFraction: Joi.number().min(0.1).max(0.9).optional(), // walk_forward only
  runs: Joi.number().integer().min(50).max(2000).optional(), // monte_carlo only
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
    params: Joi.object().optional(),
    warmup: Joi.number().integer().min(1).max(500).optional(),
  }),
);