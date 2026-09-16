import crypto from 'crypto';
import { env } from '../../../config/env';
import { BaseHttpAdapter } from './baseHttp.adapter';
import { resolveZerodhaInstrumentToken } from './instrumentResolver';
import {
  BrokerAdapter,
  BrokerCredentials,
  BrokerProfile,
  Candle,
  Funds,
  HistoricalDataParams,
  ModifyOrderRequest,
  Order,
  OrderRequest,
  OrderResponse,
  OrderStatus,
  Position,
  Quote,
} from './brokerAdapter.interface';

/** Our platform-wide timeframe -> Kite Connect's `/instruments/historical/:token/:interval` interval name. */
const ZERODHA_INTERVAL_MAP: Record<HistoricalDataParams['timeframe'], string> = {
  '1m': 'minute',
  '3m': '3minute',
  '5m': '5minute',
  '15m': '15minute',
  '30m': '30minute',
  '1h': '60minute',
  '1d': 'day',
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function formatKiteDate(d: Date): string {
  // Kite's historical API expects "yyyy-mm-dd hh:mm:ss" in IST wall-clock
  // time, not UTC — shift the instant by the IST offset, then read it back
  // out with the UTC getters so no local-timezone assumptions leak in.
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())}`;
}

/**
 * Zerodha Kite Connect uses a redirect-based login flow:
 *   1. Frontend sends the user to `${loginUrl}?v=3&api_key=<apiKey>`
 *   2. User logs into Kite directly on Zerodha's own domain (2FA handled by Zerodha)
 *   3. Zerodha redirects back to our callback with a `request_token`
 *   4. We exchange `request_token` + `api_secret` (SHA-256 checksum) for an `access_token`
 *
 * We never see the user's Zerodha password/PIN/TOTP.
 * Docs: https://kite.trade/docs/connect/v3/
 */
export class ZerodhaAdapter extends BaseHttpAdapter implements BrokerAdapter {
  public readonly brokerName = 'zerodha';
  protected baseUrl = env.brokers.zerodha.baseUrl;

  constructor(
    private apiKey: string,
    private apiSecret: string,
    private accessToken?: string,
  ) {
    super();
  }

  static buildLoginUrl(apiKey: string): string {
    return `${env.brokers.zerodha.loginUrl}?v=3&api_key=${apiKey}`;
  }

  private authHeaders() {
    return {
      Authorization: `token ${this.apiKey}:${this.accessToken}`,
      'X-Kite-Version': '3',
    };
  }

  async connect(credentials: BrokerCredentials) {
    const requestToken = String(credentials.requestToken || '');
    const checksum = crypto
      .createHash('sha256')
      .update(this.apiKey + requestToken + this.apiSecret)
      .digest('hex');

    // Kite's token endpoint expects a form-encoded body, so we bypass the
    // shared JSON `request()` helper and call fetch directly here.
    const res = await fetch(`${this.baseUrl}/session/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Kite-Version': '3' },
      body: new URLSearchParams({
        api_key: this.apiKey,
        request_token: requestToken,
        checksum,
      }).toString(),
    });
    const data = (await res.json()) as any;

    this.accessToken = data.data?.access_token || data.access_token;
    const profile: BrokerProfile = {
      clientId: data.data?.user_id || data.user_id,
      name: data.data?.user_name || data.user_name,
      email: data.data?.email,
      broker: this.brokerName,
    };
    return { accessToken: this.accessToken as string, profile };
  }

  async getProfile(): Promise<BrokerProfile> {
    const data = await this.request<any>('/user/profile', { headers: this.authHeaders() });
    const p = data.data ?? data;
    return { clientId: p.user_id, name: p.user_name, email: p.email, broker: this.brokerName };
  }

  async getFunds(): Promise<Funds> {
    const data = await this.request<any>('/user/margins/equity', { headers: this.authHeaders() });
    const m = data.data ?? data;
    return {
      availableBalance: Number(m.available?.live_balance ?? 0),
      usedMargin: Number(m.utilised?.debits ?? 0),
      totalBalance: Number(m.net ?? 0),
      collateral: Number(m.available?.collateral ?? 0),
      raw: data,
    };
  }

  async getPositions(): Promise<Position[]> {
    const data = await this.request<any>('/portfolio/positions', { headers: this.authHeaders() });
    const net = data.data?.net ?? [];
    return net.map((p: any) => ({
      tradingSymbol: p.tradingsymbol,
      exchange: p.exchange,
      segment: mapZerodhaSegment(p.exchange, p.tradingsymbol),
      productType: p.product,
      quantity: Number(p.quantity ?? 0),
      averagePrice: Number(p.average_price ?? 0),
      lastTradedPrice: Number(p.last_price ?? 0),
      realizedPnl: Number(p.realised ?? 0),
      unrealizedPnl: Number(p.unrealised ?? 0),
      raw: p,
    }));
  }

  async getOrders(): Promise<Order[]> {
    const data = await this.request<any>('/orders', { headers: this.authHeaders() });
    return (data.data ?? []).map(mapZerodhaOrder);
  }

  async placeOrder(order: OrderRequest): Promise<OrderResponse> {
    const body = new URLSearchParams({
      tradingsymbol: order.tradingSymbol,
      exchange: order.exchange,
      transaction_type: order.side,
      order_type: order.orderType,
      product: order.productType,
      quantity: String(order.quantity),
      ...(order.price ? { price: String(order.price) } : {}),
      ...(order.triggerPrice ? { trigger_price: String(order.triggerPrice) } : {}),
      validity: 'DAY',
    });
    const res = await fetch(`${this.baseUrl}/orders/regular`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = (await res.json()) as any;
    return { brokerOrderId: data.data?.order_id, status: 'SUBMITTED', raw: data };
  }

  async modifyOrder(orderId: string, order: ModifyOrderRequest): Promise<OrderResponse> {
    const body = new URLSearchParams({
      ...(order.quantity ? { quantity: String(order.quantity) } : {}),
      ...(order.price ? { price: String(order.price) } : {}),
      ...(order.triggerPrice ? { trigger_price: String(order.triggerPrice) } : {}),
      ...(order.orderType ? { order_type: order.orderType } : {}),
    });
    const res = await fetch(`${this.baseUrl}/orders/regular/${orderId}`, {
      method: 'PUT',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = (await res.json()) as any;
    return { brokerOrderId: orderId, status: 'MODIFIED', raw: data };
  }

  async cancelOrder(orderId: string): Promise<OrderResponse> {
    const data = await this.request<any>(`/orders/regular/${orderId}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    return { brokerOrderId: orderId, status: 'CANCELLED', raw: data };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const data = await this.request<any>(`/orders/${orderId}`, { headers: this.authHeaders() });
    const last = (data.data ?? []).slice(-1)[0] ?? {};
    return {
      brokerOrderId: orderId,
      status: last.status,
      filledQuantity: Number(last.filled_quantity ?? 0),
      averagePrice: Number(last.average_price ?? 0),
      raw: data,
    };
  }

  async getQuote(symbol: string): Promise<Quote> {
    const data = await this.request<any>('/quote/ltp', {
      headers: this.authHeaders(),
      query: { i: symbol },
    });
    const q = Object.values(data.data ?? {})[0] as any;
    return { tradingSymbol: symbol, ltp: Number(q?.last_price ?? 0), raw: data };
  }

  async getHistoricalData(params: HistoricalDataParams): Promise<Candle[]> {
    const instrumentToken = await resolveZerodhaInstrumentToken(
      params.exchange,
      params.tradingSymbol,
      (exchange) => this.requestText(`${this.baseUrl}/instruments/${exchange}`, { headers: this.authHeaders() }),
    );
    const interval = ZERODHA_INTERVAL_MAP[params.timeframe];

    const data = await this.request<any>(`/instruments/historical/${instrumentToken}/${interval}`, {
      headers: this.authHeaders(),
      query: {
        from: formatKiteDate(params.from),
        to: formatKiteDate(params.to),
      },
    });

    const candles = (data.data?.candles ?? []) as any[][];
    // Each record is [timestamp, open, high, low, close, volume, (oi)] with an ISO-with-offset timestamp string.
    return candles.map((c) => ({
      timestamp: new Date(c[0]).getTime(),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5] ?? 0),
    }));
  }
}

function mapZerodhaSegment(exchange: string, symbol: string): Position['segment'] {
  if (exchange === 'NFO' || exchange === 'BFO') return 'fno';
  if (exchange === 'CDS' || exchange === 'BCD') return 'currency';
  if (exchange === 'MCX') return 'commodity';
  return 'equity';
}

function mapZerodhaOrder(o: any): Order {
  return {
    brokerOrderId: o.order_id,
    tradingSymbol: o.tradingsymbol,
    exchange: o.exchange,
    segment: mapZerodhaSegment(o.exchange, o.tradingsymbol),
    side: o.transaction_type,
    orderType: o.order_type,
    productType: o.product,
    quantity: Number(o.quantity ?? 0),
    filledQuantity: Number(o.filled_quantity ?? 0),
    price: Number(o.price ?? 0),
    triggerPrice: Number(o.trigger_price ?? 0),
    averagePrice: Number(o.average_price ?? 0),
    status: o.status,
    statusMessage: o.status_message,
    placedAt: o.order_timestamp,
    raw: o,
  };
}