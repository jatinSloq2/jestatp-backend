import IORedis, { Redis } from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * General-purpose Redis client — rate limiting, caching, anything that isn't BullMQ.
 * BullMQ needs its own connection with `maxRetriesPerRequest: null` because its
 * blocking commands (BRPOPLPUSH etc.) would otherwise get prematurely retried/aborted;
 * mixing the two connection styles on one client causes hard-to-debug queue stalls.
 */
export const redisClient: Redis = new IORedis(env.redis.url, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redisClient.on('connect', () => logger.info('✅ Redis connection established'));
redisClient.on('error', (err) => logger.error(`Redis connection error: ${err.message}`));

/** Connection options for BullMQ Queues/Workers — a fresh client per Queue/Worker instance, per BullMQ's own recommendation. */
export function createBullConnection(): Redis {
  return new IORedis(env.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await redisClient.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
