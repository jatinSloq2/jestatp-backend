export const QUEUE_NAMES = {
  brokerSync: 'broker-sync',
  strategyExecution: 'strategy-execution',
} as const;

export const JOB_NAMES = {
  syncConnection: 'sync-connection',
  fanOutSync: 'fan-out-sync',
  runStrategyTick: 'run-strategy-tick',
  fanOutStrategyTicks: 'fan-out-strategy-ticks',
} as const;

export const REPEATABLE_JOB_IDS = {
  fanOutScheduler: 'broker-sync-fanout-scheduler',
  strategyTickScheduler: 'strategy-execution-fanout-scheduler',
} as const;
