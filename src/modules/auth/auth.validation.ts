import Joi from 'joi';
import { env } from '../../config/env';

const otpPattern = new RegExp(`^\\d{${env.otp.length}}$`);
const otp = () =>
  Joi.string()
    .pattern(otpPattern)
    .required()
    .messages({ 'string.pattern.base': `Code must be exactly ${env.otp.length} digits` });

export const registerSchema = Joi.object({
  fullName: Joi.string().min(2).max(120).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(128).required(),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

export const refreshSchema = Joi.object({
  // Normally the refresh token comes from the httpOnly cookie; this body
  // field is only used by non-browser API clients that can't hold cookies.
  refreshToken: Joi.string().optional(),
});

export const verifyEmailSchema = Joi.object({
  email: Joi.string().email().required(),
  code: otp(),
});

export const resendEmailVerificationSchema = Joi.object({
  email: Joi.string().email().required(),
});

export const login2faVerifySchema = Joi.object({
  code: Joi.string()
    .pattern(/^\d{6}$/)
    .required()
    .messages({ 'string.pattern.base': 'Code must be exactly 6 digits' }),
});

export const totpEnableSchema = Joi.object({
  code: Joi.string()
    .pattern(/^\d{6}$/)
    .required(),
});

export const emailTwoFaEnableSchema = Joi.object({
  code: otp(),
});

export const disable2faSchema = Joi.object({
  password: Joi.string().optional(), // required only for local accounts; enforced in the service
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

export const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  password: Joi.string().min(8).max(128).required(),
});