import { Job, Worker } from 'bullmq';
import { createBullConnection } from '../config/redis';
import { QUEUE_NAMES, JOB_NAMES } from './names';
import { BrokerConnection } from '../models';
import { syncConnectionFully } from '../modules/brokers/brokerSync.service';
import { enqueueConnectionSync, BrokerSyncJobData, SyncConnectionJobData } from './brokerSync.queue';
import { env } from '../config/env';
import { logger } from '../utils/logger';

async function processSyncConnection(data: SyncConnectionJobData) {
  const connection = await BrokerConnection.findByPk(data.connectionId);
  if (!connection || connection.status !== 'connected') {
    logger.warn(`Skipping sync job for connection ${data.connectionId} — not found or not connected`);
    return;
  }
  await syncConnectionFully(connection);
  logger.info(`Synced ${connection.broker} connection ${connection.id} (user ${connection.userId})`);
}

async function processFanOut() {
  const connections = await BrokerConnection.findAll({ where: { status: 'connected' }, attributes: ['id'] });
  logger.info(`Fan-out sync: enqueueing ${connections.length} connection(s)`);
  await Promise.all(connections.map((c) => enqueueConnectionSync(c.id)));
}

async function processor(job: Job<BrokerSyncJobData>) {
  switch (job.name) {
    case JOB_NAMES.syncConnection:
      return processSyncConnection(job.data as SyncConnectionJobData);
    case JOB_NAMES.fanOutSync:
      return processFanOut();
    default:
      logger.warn(`Unknown job name received: ${job.name}`);
  }
}

/**
 * Creates (but does not start listening until BullMQ connects) the worker
 * that processes broker-sync jobs. Concurrency is configurable via
 * WORKER_CONCURRENCY so a single worker process can be tuned per-machine,
 * and multiple worker processes (containers, VMs, etc.) can run side by side
 * for horizontal scale — BullMQ guarantees each job is picked up by exactly one.
 */
export function createBrokerSyncWorker(): Worker<BrokerSyncJobData> {
  const worker = new Worker<BrokerSyncJobData>(QUEUE_NAMES.brokerSync, processor, {
    connection: createBullConnection(),
    concurrency: env.worker.concurrency,
  });

  worker.on('completed', (job) => logger.debug(`Job ${job.id} (${job.name}) completed`));
  worker.on('failed', (job, err) => logger.error(`Job ${job?.id} (${job?.name}) failed: ${err.message}`));
  worker.on('error', (err) => logger.error(`Worker error: ${err.message}`));

  return worker;
}
