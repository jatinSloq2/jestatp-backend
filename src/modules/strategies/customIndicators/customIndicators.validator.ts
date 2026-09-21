import Joi from 'joi';

// Params: user-facing indicator inputs (e.g. { period: 14, multiplier: 2.0 })
// — free-form key/value since every indicator defines its own, but capped
// to keep the sandbox request payload and the saved row small.
const paramsSchema = Joi.object().pattern(Joi.string().max(60), Joi.alternatives(Joi.number(), Joi.string().max(200))).max(20);

export const createCustomIndicatorSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().max(1000).allow('', null).optional(),
  code: Joi.string().min(1).max(20_000).required(),
  params: paramsSchema.optional(),
});

export const updateCustomIndicatorSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  description: Joi.string().max(1000).allow('', null).optional(),
  code: Joi.string().min(1).max(20_000).optional(),
  params: paramsSchema.optional(),
}).min(1);

export const testCustomIndicatorSchema = Joi.object({
  code: Joi.string().min(1).max(20_000).required(),
  params: paramsSchema.optional(),
  broker: Joi.string().valid('dhan', 'zerodha', 'groww').optional(),
  instrument: Joi.string().max(60).optional(),
  exchange: Joi.string().max(10).optional(),
  segment: Joi.string().valid('equity', 'fno', 'currency', 'commodity').optional(),
  timeframe: Joi.string().valid('1m', '3m', '5m', '15m', '30m', '1h', '1d').optional(),
  from: Joi.string().isoDate().optional(),
  to: Joi.string().isoDate().optional(),
}).and('broker', 'instrument', 'exchange', 'timeframe');

export const customIndicatorIdParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});
