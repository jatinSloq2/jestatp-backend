import { Position } from '../../models';
import { BrokerName } from '../../models/brokerConnection.model';
import { PositionSegment } from '../../models/position.model';
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
 * Reads positions straight from Postgres; enqueues a non-blocking background
 * refresh if the cache looks stale. See order.service.ts for the same pattern.
 */
export async function getPositions(
  userId: string,
  broker: BrokerName,
  pagination: PaginationParams,
  segment?: PositionSegment,
) {
  const connection = await getActiveConnection(userId, broker);

  if (isStale(connection.lastSyncedAt)) {
    enqueueConnectionSync(connection.id).catch((err) =>
      logger.error(`Failed to enqueue background sync for connection ${connection.id}: ${err.message}`),
    );
  }

  const { count, rows } = await Position.findAndCountAll({
    where: {
      userId,
      brokerConnectionId: connection.id,
      ...(segment ? { segment } : {}),
    },
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
