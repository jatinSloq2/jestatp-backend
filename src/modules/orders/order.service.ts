import { Order } from '../../models';
import { BrokerName } from '../../models/brokerConnection.model';
import { OrderSegment } from '../../models/order.model';
import { OrderRequest } from '../brokers/adapters/brokerAdapter.interface';
import { getActiveConnection } from '../brokers/broker.service';
import { placeOrder as placeOrderWithBroker } from './orderPlacement.service';
import { PaginationParams, buildPaginationMeta } from '../../utils/pagination';
import { ApiError } from '../../utils/ApiError';
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

/**
 * Places a manual, one-off order — the human-initiated counterpart to what
 * liveEngine.ts does automatically for a `live`-mode strategy. Goes through
 * the exact same `orderPlacement.service.ts` (no `strategyId` in context,
 * so it shows up as a manual order, not attributed to any strategy), so a
 * manual order and a strategy's live order get identical tracking,
 * REJECTED-vs-thrown handling, and syncOrders() reconciliation.
 */
export async function placeManualOrder(
  userId: string,
  broker: BrokerName,
  segment: OrderSegment,
  request: OrderRequest,
): Promise<Order> {
  const connection = await getActiveConnection(userId, broker);
  const order = await placeOrderWithBroker(connection, { ...request, segment });

  if (order.status === 'REJECTED') {
    // Still a real, inspectable Order row (see it in GET /orders) — but the
    // request itself should come back as an error so the UI can show why.
    throw ApiError.badRequest(`Order rejected by ${broker}: ${order.statusMessage ?? 'no reason given'}`, { orderId: order.id });
  }

  return order;
}
