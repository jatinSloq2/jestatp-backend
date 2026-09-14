/**
 * PM2 deployment config — an alternative to docker-compose.yml for running
 * this at scale on a single VM (or a few VMs behind a load balancer) without
 * containers.
 *
 * Usage:
 *   npm run build
 *   pm2 start ecosystem.config.js --env production
 *   pm2 scale algo-api +2        # add 2 more API instances
 *   pm2 scale algo-worker +1     # add 1 more worker instance
 *
 * The API runs in PM2 "cluster" mode, which uses Node's built-in `cluster`
 * module to fork one process per CPU core and load-balance between them —
 * this alone multiplies throughput on a multi-core box with zero code
 * changes, since the app is already stateless (sessions live in Postgres/
 * Redis, not in-process memory).
 *
 * The worker runs in "fork" mode (BullMQ workers are already independent
 * job consumers; cluster mode's port-sharing behavior doesn't apply and
 * isn't needed here) — just run as many instances as your broker-sync
 * volume needs.
 */
module.exports = {
  apps: [
    {
      name: 'algo-api',
      script: 'dist/server.js',
      exec_mode: 'cluster',
      instances: process.env.PM2_API_INSTANCES || 'max',
      env_production: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
      kill_timeout: 10000, // matches the app's own graceful-shutdown force-exit timer
      wait_ready: false,
      autorestart: true,
    },
    {
      name: 'algo-worker',
      script: 'dist/worker.js',
      exec_mode: 'fork',
      instances: process.env.PM2_WORKER_INSTANCES || 2,
      env_production: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
      kill_timeout: 10000,
      autorestart: true,
    },
  ],
};
