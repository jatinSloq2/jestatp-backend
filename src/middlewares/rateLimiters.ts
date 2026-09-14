import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from '../config/redis';
import { env } from '../config/env';

/**
 * A plain in-memory rate limiter only limits requests hitting THAT process.
 * The moment you run more than one API replica behind a load balancer, an
 * attacker (or a buggy client) can get `max` requests PER INSTANCE instead
 * of per the whole fleet. Backing the limiter with Redis makes the limit
 * global and correct no matter how many API instances are running.
 */
function redisStore(prefix: string) {
  return new RedisStore({
    // rate-limit-redis expects a `sendCommand` function; ioredis exposes `.call()`.
    sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as Promise<unknown> as never,
    prefix,
  });
}

/** General API-wide limiter, applied to every request. */
export const generalLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore('rl:general:'),
});

/**
 * Tighter limiter for authentication/OTP endpoints (login, register, verify,
 * 2FA challenge) — these are brute-force/enumeration targets and deserve a
 * much lower ceiling than general API traffic.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.nodeEnv === 'production' ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore('rl:auth:'),
  message: { success: false, message: 'Too many attempts. Please try again later.' },
});
