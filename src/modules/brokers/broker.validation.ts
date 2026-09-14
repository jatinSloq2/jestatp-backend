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
