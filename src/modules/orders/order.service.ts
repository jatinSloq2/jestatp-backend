import { Order } from '../../models';
import { BrokerName } from '../../models/brokerConnection.model';
import { OrderSegment } from '../../models/order.model';
import { getActiveConnection } from '../brokers/broker.service';
import { PaginationParams, buildPaginationMeta } from '../../utils/pagination';
import { env } from '../../config/env';
import { enqueueConnectionSync } from '../../queues/brokerSync.queue';
import { logger } from '../../utils/logger';

function isStale(lastSyncedAt: Date | null): boolean {
  if (!lastSyncedAt) return true;
  return (Date.now() - lastSyncedAt.getTime()) / 1000 > env.sync.staleThresholdSeconds;
}

/**
 * Reads the user's orders straight from Postgres — no broker API call on the
 * request path, so this stays fast and scalable regardless of broker latency
 * or rate limits. If the cached data looks stale, a background refresh job
 * is enqueued (fire-and-forget) so the *next* read is fresh; the current
 * request never waits on it. Call POST /brokers/{broker}/sync for a
 * synchronous "refresh right now" instead.
 */
export async function getOrders(
  userId: string,
  broker: BrokerName,
  pagination: PaginationParams,
  segment?: OrderSegment,
) {
  const connection = await getActiveConnection(userId, broker);

  if (isStale(connection.lastSyncedAt)) {
    enqueueConnectionSync(connection.id).catch((err) =>
      logger.error(`Failed to enqueue background sync for connection ${connection.id}: ${err.message}`),
    );
  }

  const { count, rows } = await Order.findAndCountAll({
    where: {
      userId,
      brokerConnectionId: connection.id,
      ...(segment ? { segment } : {}),
    },
    order: [['placedAt', 'DESC']],
    limit: pagination.limit,
    offset: pagination.offset,
  });

  return {
    rows,
    meta: buildPaginationMeta(count, pagination.page, pagination.limit),
    lastSyncedAt: connection.lastSyncedAt,
  };
}
