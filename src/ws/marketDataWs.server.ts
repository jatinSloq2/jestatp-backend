import { IncomingMessage } from 'http';
import { Server as HttpServer } from 'http';
import { parse as parseCookie } from 'cookie';
import { WebSocket, WebSocketServer } from 'ws';
import { BrokerConnection } from '../models';
import { BrokerName } from '../models/brokerConnection.model';
import { COOKIE_NAMES } from '../utils/cookies';
import { verifyAccessToken } from '../utils/jwt';
import { logger } from '../utils/logger';
import { FeedInstrumentRequest, subscribeFeed } from '../modules/feed/feedHub';
import { FeedSegment, FeedTick } from '../modules/feed/feed.types';

const WS_PATH = '/ws/market-data';

interface SubscribeMessage {
  action: 'subscribe' | 'unsubscribe';
  broker: BrokerName;
  instruments: { exchange: string; tradingSymbol: string; segment: FeedSegment }[];
}

function isSubscribeMessage(value: unknown): value is SubscribeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.action !== 'subscribe' && v.action !== 'unsubscribe') return false;
  if (typeof v.broker !== 'string') return false;
  if (!Array.isArray(v.instruments)) return false;
  return v.instruments.every(
    (i) =>
      typeof i === 'object' &&
      i !== null &&
      typeof (i as Record<string, unknown>).exchange === 'string' &&
      typeof (i as Record<string, unknown>).tradingSymbol === 'string' &&
      typeof (i as Record<string, unknown>).segment === 'string',
  );
}

function authenticateHandshake(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      return verifyAccessToken(header.slice('Bearer '.length)).sub;
    } catch {
      return null;
    }
  }
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = parseCookie(cookieHeader);
  const token = cookies[COOKIE_NAMES.accessToken];
  if (!token) return null;
  try {
    return verifyAccessToken(token).sub;
  } catch {
    return null;
  }
}

/** One browser tab's worth of active subscriptions, keyed by `broker:exchange:tradingSymbol:segment` so a duplicate subscribe is a no-op. */
class ClientSubscriptions {
  private unsubscribers = new Map<string, () => Promise<void>>();

  static keyFor(broker: BrokerName, instr: FeedInstrumentRequest): string {
    return `${broker}:${instr.exchange}:${instr.tradingSymbol}:${instr.segment}`;
  }

  has(key: string): boolean {
    return this.unsubscribers.has(key);
  }

  set(key: string, unsubscribe: () => Promise<void>): void {
    this.unsubscribers.set(key, unsubscribe);
  }

  async remove(key: string): Promise<void> {
    const unsubscribe = this.unsubscribers.get(key);
    if (!unsubscribe) return;
    this.unsubscribers.delete(key);
    await unsubscribe();
  }

  async clear(): Promise<void> {
    const all = Array.from(this.unsubscribers.values());
    this.unsubscribers.clear();
    await Promise.all(all.map((fn) => fn().catch(() => {})));
  }
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function handleSubscribe(ws: WebSocket, userId: string, subs: ClientSubscriptions, msg: SubscribeMessage): Promise<void> {
  if (msg.instruments.length === 0) return;

  const connection = await BrokerConnection.findOne({ where: { userId, broker: msg.broker, status: 'connected' } });
  if (!connection) {
    send(ws, { type: 'error', message: `No active ${msg.broker} connection — connect it first to stream live prices.` });
    return;
  }

  const toResolve: { key: string; instr: FeedInstrumentRequest }[] = [];
  for (const raw of msg.instruments) {
    const instr: FeedInstrumentRequest = { exchange: raw.exchange, tradingSymbol: raw.tradingSymbol, segment: raw.segment };
    const key = ClientSubscriptions.keyFor(msg.broker, instr);
    if (!subs.has(key)) toResolve.push({ key, instr });
  }
  if (toResolve.length === 0) return;

  // One subscribeFeed call per instrument (run concurrently) rather than one
  // batched call for the whole message: each call's returned unsubscribe
  // only tears down what *it* added, so a later unsubscribe of a single
  // instrument never drops its siblings from this same subscribe message.
  await Promise.all(
    toResolve.map(async ({ key, instr }) => {
      try {
        const unsubscribe = await subscribeFeed(userId, connection, [instr], (tick: FeedTick) =>
          send(ws, { type: 'tick', broker: msg.broker, tick }),
        );
        subs.set(key, unsubscribe);
      } catch (err) {
        send(ws, { type: 'error', message: `Failed to subscribe ${instr.exchange}:${instr.tradingSymbol}: ${(err as Error).message}` });
      }
    }),
  );
}

async function handleUnsubscribe(userId: string, subs: ClientSubscriptions, msg: SubscribeMessage): Promise<void> {
  for (const raw of msg.instruments) {
    const key = ClientSubscriptions.keyFor(msg.broker, { exchange: raw.exchange, tradingSymbol: raw.tradingSymbol, segment: raw.segment });
    await subs.remove(key);
  }
}

export function createMarketDataWsServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === undefined || !req.url.startsWith(WS_PATH)) return; // let other upgrade handlers (if any) see it
    const userId = authenticateHandshake(req);
    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, userId);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, userId: string) => {
    const subs = new ClientSubscriptions();
    logger.info(`Market data WS connected: user=${userId}`);

    ws.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON message' });
        return;
      }
      if (!isSubscribeMessage(parsed)) {
        send(ws, { type: 'error', message: 'Expected {action, broker, instruments}' });
        return;
      }
      const action = parsed.action === 'subscribe' ? handleSubscribe(ws, userId, subs, parsed) : handleUnsubscribe(userId, subs, parsed);
      action.catch((err) => logger.error(`Market data WS handler error for user=${userId}: ${(err as Error).message}`));
    });

    ws.on('close', () => {
      logger.info(`Market data WS disconnected: user=${userId}`);
      subs.clear().catch((err) => logger.warn(`Cleanup error on WS close for user=${userId}: ${(err as Error).message}`));
    });

    ws.on('error', (err) => {
      logger.error(`Market data WS error for user=${userId}: ${err.message}`);
    });
  });

  return wss;
}
