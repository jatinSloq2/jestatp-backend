import { Job, Worker } from 'bullmq';
import { createBullConnection } from '../config/redis';
import { QUEUE_NAMES, JOB_NAMES } from './names';
import { Strategy } from '../models';
import { runStrategyTick } from '../modules/strategies/live/liveEngine';
import { enqueueStrategyTick, StrategyExecutionJobData, RunStrategyTickJobData } from './strategyExecution.queue';
import { env } from '../config/env';
import { logger } from '../utils/logger';

async function processRunStrategyTick(data: RunStrategyTickJobData) {
  const strategy = await Strategy.findByPk(data.strategyId);
  if (!strategy || strategy.status !== 'active') {
    logger.debug(`Skipping tick for strategy ${data.strategyId} — not found or no longer active`);
    return;
  }
  await runStrategyTick(strategy);
}

async function processFanOutStrategyTicks() {
  const strategies = await Strategy.findAll({ where: { status: 'active' }, attributes: ['id'] });
  logger.info(`Strategy execution fan-out: enqueueing ${strategies.length} active strategy tick(s)`);
  await Promise.all(strategies.map((s) => enqueueStrategyTick(s.id)));
}

async function processor(job: Job<StrategyExecutionJobData>) {
  switch (job.name) {
    case JOB_NAMES.runStrategyTick:
      return processRunStrategyTick(job.data as RunStrategyTickJobData);
    case JOB_NAMES.fanOutStrategyTicks:
      return processFanOutStrategyTicks();
    default:
      logger.warn(`Unknown strategy-execution job name received: ${job.name}`);
  }
}

/**
 * Creates the worker that processes strategy execution ticks. Runs at
 * lower concurrency than broker-sync by default — a strategy tick fetches
 * historical candles AND may call out to the sandbox service, so it's
 * heavier per-job than a broker sync call.
 */
export function createStrategyExecutionWorker(): Worker<StrategyExecutionJobData> {
  const worker = new Worker<StrategyExecutionJobData>(QUEUE_NAMES.strategyExecution, processor, {
    connection: createBullConnection(),
    concurrency: env.strategyExecution.concurrency,
  });

  worker.on('completed', (job) => logger.debug(`Job ${job.id} (${job.name}) completed`));
  worker.on('failed', (job, err) => logger.error(`Job ${job?.id} (${job?.name}) failed: ${err.message}`));
  worker.on('error', (err) => logger.error(`Strategy execution worker error: ${err.message}`));

  return worker;
}
