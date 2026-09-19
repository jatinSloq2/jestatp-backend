import { connectDatabase, sequelize } from './config/database';
import { redisClient } from './config/redis';
import { createBrokerSyncWorker } from './queues/brokerSync.worker';
import { scheduleFanOutSync, brokerSyncQueue } from './queues/brokerSync.queue';
import { createStrategyExecutionWorker } from './queues/strategyExecution.worker';
import { scheduleStrategyTickFanOut, strategyExecutionQueue } from './queues/strategyExecution.queue';
import { logger } from './utils/logger';
import { env } from './config/env';

let shuttingDown = false;

async function bootstrap() {
  await connectDatabase();

  const brokerWorker = createBrokerSyncWorker();
  await brokerWorker.waitUntilReady();
  await scheduleFanOutSync();

  const strategyWorker = createStrategyExecutionWorker();
  await strategyWorker.waitUntilReady();
  await scheduleStrategyTickFanOut();

  logger.info(
    `🛠️  Broker-sync worker online (concurrency=${env.worker.concurrency}, fan-out every ${env.sync.schedulerIntervalSeconds}s)`,
  );
  logger.info(
    `🤖 Strategy-execution worker online (concurrency=${env.strategyExecution.concurrency}, fan-out every ${env.strategyExecution.schedulerIntervalSeconds}s)`,
  );

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down worker gracefully...`);
    try {
      await brokerWorker.close(); // waits for in-flight jobs to finish
      await strategyWorker.close();
      await brokerSyncQueue.close();
      await strategyExecutionQueue.close();
      await redisClient.quit();
      await sequelize.close();
      logger.info('Worker shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error(`Error during worker shutdown: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error(`Worker failed to start: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection in worker: ${reason}`);
});
