export const QUEUE_NAMES = {
  brokerSync: 'broker-sync',
} as const;

export const JOB_NAMES = {
  syncConnection: 'sync-connection',
  fanOutSync: 'fan-out-sync',
} as const;

export const REPEATABLE_JOB_IDS = {
  fanOutScheduler: 'broker-sync-fanout-scheduler',
} as const;
