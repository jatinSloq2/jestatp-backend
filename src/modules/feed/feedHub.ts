import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { BrokerConnection } from '../../models';
import { BrokerName } from '../../models/brokerConnection.model';
import { logger } from '../../utils/logger';
import { buildFeedCredentials } from './feedCredentials';
import {
  addFeedInstruments,
  closeFeedSession,
  createFeedSession,
  openFeedStream,
  removeFeedInstruments,
} from './feedService.client';
import { FeedInstrument, FeedTick } from './feed.types';
import { resolveFeedToken } from './instrumentToken.service';

export type FeedInstrumentRequest = Omit<FeedInstrument, 'token'>;

interface SessionEntry {
  sessionId: string;
  broker: BrokerName;
  ws: WebSocket;
  emitter: EventEmitter;
  /** token -> number of active local subscribers wanting it */
  refCounts: Map<string, number>;
}

/**
 * In-process registry: one feed-service session per (userId, broker). Not
 * shared across Node instances — if this service is ever scaled to more
 * than one process/pod, this needs to move to a shared store (Redis) with
 * sticky session-affinity for the websocket relay, same caveat as the feed
 * service's own SessionManager.
 */
const sessions = new Map<string, SessionEntry>();

/**
 * Per-(user, broker) serialization: `subscribeFeed` and the unsubscribe
 * functions it returns both read-then-write the same `sessions` entry
 * (check-if-exists, create-or-add, adjust ref counts). Without this lock,
 * two concurrent calls for the same key — e.g. a browser tab subscribing to
 * a whole option chain at once, one `subscribeFeed` call per strike — can
 * race: both see no existing session and each create one, or one caller's
 * instrument silently never reaches the broker feed because it missed the
 * window where the initial subscription payload was built.
 */
const keyLocks = new Map<string, Promise<unknown>>();

function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = keyLocks.get(key) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  keyLocks.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}

function sessionKey(userId: string, broker: BrokerName): string {
  return `${userId}:${broker}`;
}

async function resolveInstruments(
  connection: BrokerConnection,
  requested: FeedInstrumentRequest[],
): Promise<FeedInstrument[]> {
  const creds = buildFeedCredentials(connection);
  const tokenCreds = connection.broker === 'zerodha' ? { zerodha: { apiKey: creds.apiKey, accessToken: creds.accessToken } } : {};

  return Promise.all(
    requested.map(async (instr) => ({
      ...instr,
      token: await resolveFeedToken(connection.broker, instr.exchange, instr.tradingSymbol, instr.segment, tokenCreds),
    })),
  );
}

async function createSessionEntry(
  userId: string,
  key: string,
  connection: BrokerConnection,
  initial: FeedInstrument[],
): Promise<SessionEntry> {
  const creds = buildFeedCredentials(connection);
  const { sessionId } = await createFeedSession(connection.broker, creds, initial);
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const ws = openFeedStream(sessionId, {
    onTick: (tick) => emitter.emit('tick', tick),
    onError: (message) => logger.error(`Feed session ${sessionId} (${connection.broker}) error: ${message}`),
    onClose: (code, reason) => {
      logger.warn(`Feed session ${sessionId} (${connection.broker}) stream closed: ${code} ${reason}`);
      sessions.delete(key);
    },
  });

  const entry: SessionEntry = { sessionId, broker: connection.broker, ws, emitter, refCounts: new Map() };
  sessions.set(key, entry);
  logger.info(`Feed session ${sessionId} started for user=${userId} broker=${connection.broker}`);
  return entry;
}

/**
 * Subscribes `onTick` to live updates for `instruments`, reusing an
 * existing feed-service session for this (user, broker) pair if one is
 * already running and only asking the feed service to add whichever
 * instruments aren't already subscribed. Returns an unsubscribe function
 * that decrements ref counts and tears the whole session down once nothing
 * local is listening to it anymore.
 */
export async function subscribeFeed(
  userId: string,
  connection: BrokerConnection,
  instruments: FeedInstrumentRequest[],
  onTick: (tick: FeedTick) => void,
): Promise<() => Promise<void>> {
  if (instruments.length === 0) {
    return async () => {};
  }

  const resolved = await resolveInstruments(connection, instruments);
  const key = sessionKey(userId, connection.broker);

  return withKeyLock(key, async () => {
    let entry = sessions.get(key);
    if (!entry) {
      entry = await createSessionEntry(userId, key, connection, resolved);
    } else {
      const newOnes = resolved.filter((i) => !entry!.refCounts.has(i.token));
      if (newOnes.length > 0) {
        await addFeedInstruments(entry.sessionId, newOnes);
      }
    }

    for (const instr of resolved) {
      entry.refCounts.set(instr.token, (entry.refCounts.get(instr.token) ?? 0) + 1);
    }

    const byToken = new Map(resolved.map((i) => [i.token, i]));
    const wantedIdentities = new Set(resolved.map((i) => `${i.exchange}:${i.tradingSymbol}:${i.segment}`));
    const capturedEntry = entry;
    const listener = (tick: FeedTick) => {
      // The emitter is shared by every local subscriber of this (user, broker)
      // session — a different caller may have added instruments this one
      // never asked for (e.g. two strategies on the same broker connection) —
      // so filter to exactly the instruments *this* subscription resolved.
      if (wantedIdentities.has(`${tick.exchange}:${tick.tradingSymbol}:${tick.segment}`)) {
        onTick(tick);
      }
    };
    capturedEntry.emitter.on('tick', listener);

    let unsubscribed = false;
    return async () => {
      if (unsubscribed) return; // idempotent: caller may call this more than once during teardown races
      unsubscribed = true;

      await withKeyLock(key, async () => {
        capturedEntry.emitter.off('tick', listener);

        const toRemove: FeedInstrument[] = [];
        for (const [token, instr] of byToken) {
          const remaining = (capturedEntry.refCounts.get(token) ?? 1) - 1;
          if (remaining <= 0) {
            capturedEntry.refCounts.delete(token);
            toRemove.push(instr);
          } else {
            capturedEntry.refCounts.set(token, remaining);
          }
        }

        if (toRemove.length > 0) {
          await removeFeedInstruments(capturedEntry.sessionId, toRemove).catch((err) =>
            logger.warn(`Failed to unsubscribe instruments from feed session ${capturedEntry.sessionId}: ${(err as Error).message}`),
          );
        }

        if (capturedEntry.refCounts.size === 0 && sessions.get(key) === capturedEntry) {
          sessions.delete(key);
          capturedEntry.ws.close();
          await closeFeedSession(capturedEntry.sessionId).catch((err) =>
            logger.warn(`Failed to close idle feed session ${capturedEntry.sessionId}: ${(err as Error).message}`),
          );
        }
      });
    };
  });
}
