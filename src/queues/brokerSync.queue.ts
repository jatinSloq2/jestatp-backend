import { Queue } from 'bullmq';
import { createBullConnection } from '../config/redis';
import { JOB_NAMES, QUEUE_NAMES, REPEATABLE_JOB_IDS } from './names';
import { env } from '../config/env';

export interface SyncConnectionJobData {
  connectionId: string;
}

export interface FanOutJobData {
  // no payload — the fan-out job looks up all connected broker accounts itself
}

export type BrokerSyncJobData = SyncConnectionJobData | FanOutJobData;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 3600, count: 500 }, // keep an hour / 500 jobs of history for debugging, then GC
  removeOnFail: { age: 86400 }, // keep failures for a day so they're visible before they're pruned
};

export const brokerSyncQueue = new Queue<BrokerSyncJobData>(QUEUE_NAMES.brokerSync, {
  connection: createBullConnection(),
  defaultJobOptions,
});

/**
 * Enqueues an immediate, high-priority sync for one broker connection —
 * used by the "sync now" API endpoint. Returns right away; the actual
 * broker call happens in a worker process, not on the request thread.
 */
export async function enqueueConnectionSync(connectionId: string) {
  return brokerSyncQueue.add(
    JOB_NAMES.syncConnection,
    { connectionId },
    { priority: 1, jobId: `sync:${connectionId}:${Date.now()}` },
  );
}

/**
 * Registers the recurring "check every connected broker account" job.
 * Idempotent — BullMQ dedupes repeatable jobs by their `jobId`, so calling
 * this from every worker replica on boot is safe and only schedules once.
 */
export async function scheduleFanOutSync() {
  await brokerSyncQueue.add(
    JOB_NAMES.fanOutSync,
    {},
    {
      repeat: { every: env.sync.schedulerIntervalSeconds * 1000 },
      jobId: REPEATABLE_JOB_IDS.fanOutScheduler,
    },
  );
}
