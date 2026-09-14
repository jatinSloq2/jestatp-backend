import { connectDatabase, sequelize } from './config/database';
import { redisClient } from './config/redis';
import { createBrokerSyncWorker } from './queues/brokerSync.worker';
import { scheduleFanOutSync, brokerSyncQueue } from './queues/brokerSync.queue';
import { logger } from './utils/logger';
import { env } from './config/env';

let shuttingDown = false;

async function bootstrap() {
  await connectDatabase();

  const worker = createBrokerSyncWorker();
  await worker.waitUntilReady();
  await scheduleFanOutSync();

  logger.info(
    `🛠️  Broker-sync worker online (concurrency=${env.worker.concurrency}, fan-out every ${env.sync.schedulerIntervalSeconds}s)`,
  );

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down worker gracefully...`);
    try {
      await worker.close(); // waits for in-flight jobs to finish
      await brokerSyncQueue.close();
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
