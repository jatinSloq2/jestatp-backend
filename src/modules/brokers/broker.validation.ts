import Joi from 'joi';

export const connectDhanSchema = Joi.object({
  clientId: Joi.string().required(),
  accessToken: Joi.string().required(),
});

export const connectZerodhaInitSchema = Joi.object({
  apiKey: Joi.string().required(),
  apiSecret: Joi.string().required(),
});

export const connectZerodhaCallbackSchema = Joi.object({
  requestToken: Joi.string().required(),
});

export const connectGrowwSchema = Joi.object({
  apiKey: Joi.string().required(),
  apiSecret: Joi.string().required(),
});

export const brokerParamSchema = Joi.object({
  broker: Joi.string().valid('dhan', 'zerodha', 'groww').required(),
});

export const quoteQuerySchema = Joi.object({
  symbol: Joi.string().min(1).max(60).required(),
  exchange: Joi.string().min(1).max(10).uppercase().optional(),
});
