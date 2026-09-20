import { BrokerName } from '../../models/brokerConnection.model';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Next occurrence of `hour:minute` IST at or after `from` (same trick as backtestEngine.ts's istDayKey/istTimeOfDay: shift the instant by the IST offset, read UTC fields off the shifted instant as if they were IST wall-clock fields, then shift back). */
function nextIstTime(from: Date, hour: number, minute: number): Date {
  const shifted = new Date(from.getTime() + IST_OFFSET_MS);
  const istMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  let candidate = istMidnight + (hour * 60 + minute) * 60_000;
  if (candidate <= shifted.getTime()) candidate += 24 * 60 * 60_000;
  return new Date(candidate - IST_OFFSET_MS);
}

/**
 * Returns when a freshly-connected session for this broker will stop
 * working, based on each broker's actual documented token lifetime —
 * verified directly against current broker docs/support pages, not assumed:
 *
 *   - Zerodha (Kite Connect): ALL access tokens are flushed daily, ~7:30 AM
 *     IST, regardless of when they were generated the day before.
 *   - Groww: access tokens always expire daily at exactly 6:00 AM IST.
 *   - Dhan: NOT a fixed wall-clock reset — tokens are a rolling 24-hour
 *     window from generation (24h is also the current regulatory max,
 *     per SEBI's algo-trading token-duration rules). We only know when the
 *     user PASTED the token into our UI, not when Dhan actually generated
 *     it, so 24h from connection time is used as a conservative estimate —
 *     it may read as still-valid slightly after Dhan has actually expired
 *     it, which is exactly why this is only ONE of two layers (see
 *     broker.service.ts's getActiveConnection, which also reacts to the
 *     broker's own "session expired" error in real time regardless of what
 *     this function predicted).
 */
export function computeTokenExpiry(broker: BrokerName, connectedAt: Date = new Date()): Date {
  switch (broker) {
    case 'zerodha':
      return nextIstTime(connectedAt, 7, 30);
    case 'groww':
      return nextIstTime(connectedAt, 6, 0);
    case 'dhan':
      return new Date(connectedAt.getTime() + 24 * 60 * 60 * 1000);
  }
}
