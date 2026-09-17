import { Holding } from '../../models';
import { BrokerName } from '../../models/brokerConnection.model';
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
 * Reads holdings straight from Postgres; enqueues a non-blocking background
 * refresh if the cache looks stale. Same read-through-cache pattern as
 * position.service.ts and order.service.ts — this deliberately never calls
 * the broker directly on the request thread, so a slow/rate-limited broker
 * API never blocks the page load.
 */
export async function getHoldings(userId: string, broker: BrokerName, pagination: PaginationParams) {
  const connection = await getActiveConnection(userId, broker);

  if (isStale(connection.lastSyncedAt)) {
    enqueueConnectionSync(connection.id).catch((err) =>
      logger.error(`Failed to enqueue background sync for connection ${connection.id}: ${err.message}`),
    );
  }

  const { count, rows } = await Holding.findAndCountAll({
    where: { userId, brokerConnectionId: connection.id },
    order: [['tradingSymbol', 'ASC']],
    limit: pagination.limit,
    offset: pagination.offset,
  });

  return {
    rows,
    meta: buildPaginationMeta(count, pagination.page, pagination.limit),
    lastSyncedAt: connection.lastSyncedAt,
  };
}