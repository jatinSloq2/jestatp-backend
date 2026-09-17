import WebSocket from 'ws';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { BrokerName } from '../../models/brokerConnection.model';
import { FeedInstrument, FeedSessionStatus, FeedTick, FeedWsEnvelope } from './feed.types';

function feedHttpUrl(path: string): string {
  return new URL(path, env.feedService.url).toString();
}

function feedWsUrl(sessionId: string): string {
  const httpUrl = new URL(`/ws/sessions/${sessionId}`, env.feedService.url);
  httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  httpUrl.searchParams.set('token', env.feedService.internalToken);
  return httpUrl.toString();
}

async function feedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(feedHttpUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': env.feedService.internalToken,
      ...init.headers,
    },
  });

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }

  if (!response.ok) {
    const detail = (json as { detail?: string } | undefined)?.detail;
    throw new ApiError(
      response.status >= 500 ? 502 : 400,
      `Feed service error (${response.status}): ${detail ?? response.statusText}`,
      json,
    );
  }

  return json as T;
}

export async function createFeedSession(
  broker: BrokerName,
  credentials: Record<string, string>,
  instruments: FeedInstrument[],
): Promise<{ sessionId: string; broker: BrokerName; subscribedCount: number }> {
  return feedRequest('/sessions', {
    method: 'POST',
    body: JSON.stringify({ broker, credentials, instruments }),
  });
}

export async function addFeedInstruments(sessionId: string, instruments: FeedInstrument[]): Promise<FeedSessionStatus> {
  return feedRequest(`/sessions/${sessionId}/instruments`, {
    method: 'POST',
    body: JSON.stringify({ instruments }),
  });
}

export async function removeFeedInstruments(sessionId: string, instruments: FeedInstrument[]): Promise<FeedSessionStatus> {
  return feedRequest(`/sessions/${sessionId}/instruments`, {
    method: 'DELETE',
    body: JSON.stringify({ instruments }),
  });
}

export async function getFeedSessionStatus(sessionId: string): Promise<FeedSessionStatus> {
  return feedRequest(`/sessions/${sessionId}`);
}

export async function closeFeedSession(sessionId: string): Promise<void> {
  await feedRequest(`/sessions/${sessionId}`, { method: 'DELETE' });
}

export interface FeedStreamHandlers {
  onTick: (tick: FeedTick) => void;
  onStatus?: (status: FeedSessionStatus) => void;
  onError?: (message: string) => void;
  onClose?: (code: number, reason: string) => void;
}

/**
 * Opens the server-push websocket for one feed session and wires callbacks.
 * The socket is push-only from the feed service's side; we still send a
 * lightweight ping periodically so intermediary proxies don't idle it out,
 * matching the assumption baked into the feed service's `receive_text()`
 * keep-alive loop.
 */
export function openFeedStream(sessionId: string, handlers: FeedStreamHandlers): WebSocket {
  const ws = new WebSocket(feedWsUrl(sessionId), {
    headers: { 'X-Internal-Token': env.feedService.internalToken },
  });

  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send('ping');
  }, 20_000);

  ws.on('message', (raw) => {
    let envelope: FeedWsEnvelope;
    try {
      envelope = JSON.parse(raw.toString());
    } catch {
      logger.warn(`Feed stream ${sessionId}: received non-JSON message, ignoring`);
      return;
    }
    if (envelope.type === 'tick') {
      handlers.onTick(envelope.tick);
    } else if (envelope.type === 'status') {
      handlers.onStatus?.(envelope.status);
    } else if (envelope.type === 'error') {
      handlers.onError?.(envelope.message);
    }
  });

  ws.on('close', (code, reasonBuf) => {
    clearInterval(pingInterval);
    handlers.onClose?.(code, reasonBuf.toString());
  });

  ws.on('error', (err) => {
    logger.error(`Feed stream ${sessionId} error: ${err.message}`);
  });

  return ws;
}
