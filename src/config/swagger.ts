import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Algo Trading Platform API — Phase 1',
      version: '1.0.0',
      description:
        'Foundation backend: Authentication (JWT + Google OAuth), Broker Connect (Dhan/Zerodha/Groww), ' +
        'and live Orders / Positions / Funds sync via the broker adapter layer. ' +
        'Backtesting, paper trading, live execution, the strategy builder, and the risk/OMS engine ' +
        'are built in later phases on top of this foundation.',
    },
    servers: [{ url: `http://localhost:${env.port}${env.apiPrefix}`, description: 'Local' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Registration, login, refresh, Google OAuth' },
      { name: 'Users', description: 'User profile' },
      { name: 'Brokers', description: 'Connect/disconnect Dhan, Zerodha, Groww' },
      { name: 'Orders', description: 'Live order book synced from the connected broker' },
      { name: 'Positions', description: 'Live positions (equity delivery + F&O) synced from the broker' },
      { name: 'Funds', description: "User's available balance / margin" },
      { name: 'Strategies', description: 'Strategy Builder output — create, version, validate, and manage the lifecycle of a Strategy JSON' },
    ],
  },
  apis: ['./src/modules/**/*.routes.ts', './dist/modules/**/*.routes.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
