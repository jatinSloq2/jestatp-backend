require('dotenv').config();

const base = {
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'algo_trading',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  dialect: process.env.DB_DIALECT || 'postgres',
};

module.exports = {
  development: base,
  test: { ...base, database: `${base.database}_test` },
  production: { ...base, dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } },
};
