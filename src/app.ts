import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import passport from './config/passport';
import { env } from './config/env';
import { swaggerSpec } from './config/swagger';
import apiRoutes from './routes';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { generalLimiter } from './middlewares/rateLimiters';
import { sequelize } from './config/database';
import { checkRedisHealth } from './config/redis';

export function createApp(): Application {
  const app = express();

  app.set('trust proxy', 1); // needed for correct req.ip behind a load balancer/reverse proxy

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
  app.use(passport.initialize());
  app.use(generalLimiter);

  app.get('/health', async (_req, res) => {
    const [dbOk, redisOk] = await Promise.all([
      sequelize
        .authenticate()
        .then(() => true)
        .catch(() => false),
      checkRedisHealth(),
    ]);

    const healthy = dbOk && redisOk;
    res.status(healthy ? 200 : 503).json({
      success: healthy,
      status: healthy ? 'ok' : 'degraded',
      database: dbOk ? 'connected' : 'unreachable',
      redis: redisOk ? 'connected' : 'unreachable',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customSiteTitle: 'Algo Trading API Docs' }));
  app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));

  app.use(env.apiPrefix, apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
