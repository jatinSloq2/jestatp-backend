import { Server } from 'http';
import { createApp } from './app';
import { connectDatabase, sequelize } from './config/database';
import { redisClient } from './config/redis';
import { brokerSyncQueue } from './queues/brokerSync.queue';
import { env } from './config/env';
import { logger } from './utils/logger';

let server: Server | undefined;
let shuttingDown = false;

async function bootstrap() {
  try {
    await connectDatabase();

    const app = createApp();
    server = app.listen(env.port, () => {
      logger.info(`🚀 Algo Trading Platform API running on port ${env.port}`);
      logger.info(`📖 Swagger docs: http://localhost:${env.port}/api-docs`);
      logger.info(`🩺 Health check: http://localhost:${env.port}/health`);
    });
  } catch (err) {
    logger.error(`Failed to start server: ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * Graceful shutdown: stop accepting new connections, let in-flight requests
 * finish, close the DB pool, then exit. Prevents dropped requests and
 * connection leaks on deploys/restarts (PM2, Docker, Kubernetes, etc. all
 * send SIGTERM before killing the process).
 */
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — shutting down gracefully...`);

  const forceExitTimer = setTimeout(() => {
    logger.error('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
      logger.info('HTTP server closed');
    }
    await sequelize.close();
    logger.info('Database connection pool closed');
    await brokerSyncQueue.close();
    await redisClient.quit();
    logger.info('Redis connections closed');
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    logger.error(`Error during shutdown: ${(err as Error).message}`);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.stack || err.message}`);
  // An uncaught exception leaves the process in an undefined state — exit
  // after attempting a clean shutdown rather than limping along.
  shutdown('uncaughtException');
});

bootstrap();
