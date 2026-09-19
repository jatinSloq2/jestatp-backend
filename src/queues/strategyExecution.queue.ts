import { Queue } from 'bullmq';
import { createBullConnection } from '../config/redis';
import { JOB_NAMES, QUEUE_NAMES, REPEATABLE_JOB_IDS } from './names';
import { env } from '../config/env';

export interface RunStrategyTickJobData {
  strategyId: string;
}

export interface FanOutStrategyTicksJobData {
  // no payload — looks up every `active` strategy itself, same pattern as brokerSync's fan-out
}

export type StrategyExecutionJobData = RunStrategyTickJobData | FanOutStrategyTicksJobData;

const defaultJobOptions = {
  attempts: 2, // a strategy tick is idempotent (see liveEngine.ts's timestamp-based de-dupe) but not worth retrying hard — the next scheduled tick will catch up regardless
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
};

export const strategyExecutionQueue = new Queue<StrategyExecutionJobData>(QUEUE_NAMES.strategyExecution, {
  connection: createBullConnection(),
  defaultJobOptions,
});

export async function enqueueStrategyTick(strategyId: string) {
  return strategyExecutionQueue.add(
    JOB_NAMES.runStrategyTick,
    { strategyId },
    // jobId keyed by strategy+minute (not strategy+Date.now()) so if the
    // fan-out somehow runs twice in the same minute, BullMQ dedupes it
    // rather than running the same strategy's tick concurrently with itself.
    { jobId: `strategy-tick:${strategyId}:${Math.floor(Date.now() / 60_000)}` },
  );
}

/** Registers the recurring "check every active strategy" job — idempotent, same as brokerSync's scheduleFanOutSync. */
export async function scheduleStrategyTickFanOut() {
  await strategyExecutionQueue.add(
    JOB_NAMES.fanOutStrategyTicks,
    {},
    {
      repeat: { every: env.strategyExecution.schedulerIntervalSeconds * 1000 },
      jobId: REPEATABLE_JOB_IDS.strategyTickScheduler,
    },
  );
}
