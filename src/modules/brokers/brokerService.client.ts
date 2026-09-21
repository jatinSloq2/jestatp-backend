import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { BrokerName } from '../../models/brokerConnection.model';
import {
  BrokerCredentials,
  BrokerProfile,
  Candle,
  Funds,
  HistoricalDataParams,
  Holding,
  IndexUnderlying,
  ModifyOrderRequest,
  OptionChain,
  Order,
  OrderRequest,
  OrderResponse,
  OrderStatus,
  Position,
  Quote,
} from './adapters/brokerAdapter.interface';

/**
 * All broker interaction — live feed sessions AND trading — is owned by
 * jestatp-broker-service, which wraps the official dhanhq / kiteconnect /
 * growwapi SDKs. This client is the ONLY place in Node that calls it for
 * trading operations; nothing here talks to Dhan/Kite/Groww directly.
 *
 * Every call sends `credentials` in the body — this service is stateless
 * for trading (unlike feed sessions), so each request carries whatever
 * Node already holds decrypted for that connection.
 */

function brokerServiceUrl(path: string): string {
  return new URL(path, env.brokerService.url).toString();
}

async function brokerRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(brokerServiceUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': env.brokerService.internalToken,
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
    // FastAPI's `detail` is either a plain string (ordinary errors) or, for
    // errors we've classified broker-side (see trading.py's
    // `_catch_broker_errors`), `{ errorCode, message }` — pull errorCode out
    // when present so callers can branch on it (e.g. DATA_PLAN_REQUIRED)
    // instead of pattern-matching the human-readable message text.
    const detail = (json as { detail?: string | { errorCode?: string; message?: string } } | undefined)?.detail;
    const detailIsObject = typeof detail === 'object' && detail !== null;
    const errorCode = detailIsObject ? detail.errorCode : undefined;
    const detailMessage = detailIsObject ? detail.message : detail;
    throw new ApiError(
      response.status >= 500 ? 502 : 400,
      `Broker service error (${response.status}): ${detailMessage ?? response.statusText}`,
      json,
      true,
      errorCode,
    );
  }

  return json as T;
}

function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return brokerRequest<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function connectBroker(
  broker: BrokerName,
  credentials: BrokerCredentials,
): Promise<{ accessToken: string; profile: BrokerProfile }> {
  return post(`/brokers/${broker}/connect`, { credentials });
}

export async function getZerodhaLoginUrl(apiKey: string): Promise<string> {
  const path = `/brokers/zerodha/login-url?apiKey=${encodeURIComponent(apiKey)}`;
  const { loginUrl } = await brokerRequest<{ loginUrl: string }>(path, { method: 'GET' });
  return loginUrl;
}

export async function getBrokerProfile(broker: BrokerName, credentials: BrokerCredentials): Promise<BrokerProfile> {
  return post(`/brokers/${broker}/profile`, { credentials });
}

export async function getBrokerFunds(broker: BrokerName, credentials: BrokerCredentials): Promise<Funds> {
  return post(`/brokers/${broker}/funds`, { credentials });
}

export async function getBrokerPositions(broker: BrokerName, credentials: BrokerCredentials): Promise<Position[]> {
  return post(`/brokers/${broker}/positions`, { credentials });
}

export async function getBrokerHoldings(broker: BrokerName, credentials: BrokerCredentials): Promise<Holding[]> {
  return post(`/brokers/${broker}/holdings`, { credentials });
}

export async function getBrokerOrders(broker: BrokerName, credentials: BrokerCredentials): Promise<Order[]> {
  return post(`/brokers/${broker}/orders/list`, { credentials });
}

export async function placeBrokerOrder(
  broker: BrokerName,
  credentials: BrokerCredentials,
  order: OrderRequest,
): Promise<OrderResponse> {
  return post(`/brokers/${broker}/orders/place`, { credentials, order });
}

export async function modifyBrokerOrder(
  broker: BrokerName,
  credentials: BrokerCredentials,
  orderId: string,
  order: ModifyOrderRequest,
): Promise<OrderResponse> {
  return brokerRequest(`/brokers/${broker}/orders/${orderId}`, {
    method: 'PUT',
    body: JSON.stringify({ credentials, order }),
  });
}

export async function cancelBrokerOrder(
  broker: BrokerName,
  credentials: BrokerCredentials,
  orderId: string,
): Promise<OrderResponse> {
  return post(`/brokers/${broker}/orders/${orderId}/cancel`, { credentials });
}

export async function getBrokerOrderStatus(
  broker: BrokerName,
  credentials: BrokerCredentials,
  orderId: string,
): Promise<OrderStatus> {
  return post(`/brokers/${broker}/orders/${orderId}/status`, { credentials });
}

export async function getBrokerQuote(
  broker: BrokerName,
  credentials: BrokerCredentials,
  tradingSymbol: string,
  exchange = 'NSE',
): Promise<Quote> {
  return post(`/brokers/${broker}/quote`, { credentials, tradingSymbol, exchange });
}

/**
 * Resolves the broker-specific *feed* subscription id for one instrument —
 * Dhan's `securityId`, Zerodha's `instrument_token`, Groww's
 * `exchange_token` — used by feedHub before opening a live-feed session.
 */
export async function resolveFeedToken(
  broker: BrokerName,
  credentials: Record<string, string | undefined>,
  exchange: string,
  tradingSymbol: string,
  segment?: string,
): Promise<string> {
  const { token } = await post<{ token: string }>(`/brokers/${broker}/resolve-feed-token`, {
    credentials,
    tradingSymbol,
    exchange,
    segment,
  });
  return token;
}

export async function getBrokerHistoricalData(
  broker: BrokerName,
  credentials: BrokerCredentials,
  params: HistoricalDataParams,
): Promise<Candle[]> {
  return post(`/brokers/${broker}/historical`, {
    credentials,
    tradingSymbol: params.tradingSymbol,
    exchange: params.exchange,
    segment: params.segment,
    timeframe: params.timeframe,
    from: params.from.toISOString(),
    to: params.to.toISOString(),
  });
}

export async function getBrokerOptionChainExpiries(
  broker: BrokerName,
  credentials: BrokerCredentials,
  underlying: IndexUnderlying,
): Promise<string[]> {
  return post(`/brokers/${broker}/option-chain/expiries`, { credentials, underlying });
}

export async function getBrokerOptionChain(
  broker: BrokerName,
  credentials: BrokerCredentials,
  underlying: IndexUnderlying,
  expiry?: string,
): Promise<OptionChain> {
  return post(`/brokers/${broker}/option-chain`, { credentials, underlying, expiry });
}