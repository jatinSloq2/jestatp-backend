import { Fund } from '../../models';
import { BrokerName } from '../../models/brokerConnection.model';
import { getActiveConnection } from '../brokers/broker.service';
import { env } from '../../config/env';
import { enqueueConnectionSync } from '../../queues/brokerSync.queue';
import { syncFunds } from '../brokers/brokerSync.service';
import { logger } from '../../utils/logger';

function isStale(lastSyncedAt: Date | null): boolean {
  if (!lastSyncedAt) return true;
  return (Date.now() - lastSyncedAt.getTime()) / 1000 > env.sync.staleThresholdSeconds;
}

/**
 * Reads the cached fund/balance snapshot from Postgres. If it's stale, a
 * background refresh is enqueued (non-blocking). The one exception: if this
 * connection has NEVER been synced before, there's nothing to show yet, so
 * this does one synchronous sync so the very first call isn't an empty response.
 */
export async function getFunds(userId: string, broker: BrokerName) {
  const connection = await getActiveConnection(userId, broker);

  let record = await Fund.findOne({ where: { brokerConnectionId: connection.id } });

  if (!record) {
    await syncFunds(connection);
    await connection.update({ lastSyncedAt: new Date() });
    record = await Fund.findOne({ where: { brokerConnectionId: connection.id } });
  } else if (isStale(connection.lastSyncedAt)) {
    enqueueConnectionSync(connection.id).catch((err) =>
      logger.error(`Failed to enqueue background sync for connection ${connection.id}: ${err.message}`),
    );
  }

  return record;
}
