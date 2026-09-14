import { Sequelize } from 'sequelize';
import { env } from './env';
import { logger } from '../utils/logger';

export const sequelize = new Sequelize(env.db.name, env.db.user, env.db.password, {
  host: env.db.host,
  port: env.db.port,
  dialect: env.db.dialect,
  logging: env.db.logging ? (sql: string) => logger.debug(sql) : false,
  define: {
    underscored: true,
    freezeTableName: false,
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  dialectOptions:
    env.nodeEnv === 'production'
      ? { ssl: { require: true, rejectUnauthorized: false } }
      : {},
  retry: { max: 3 },
});

export async function connectDatabase(): Promise<void> {
  await sequelize.authenticate();
  logger.info('✅ PostgreSQL connection established (Sequelize)');
}
