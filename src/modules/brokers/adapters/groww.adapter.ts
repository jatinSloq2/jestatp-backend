import crypto from 'crypto';
import { env } from '../../../config/env';
import { BaseHttpAdapter } from './baseHttp.adapter';
import {
  BrokerAdapter,
  BrokerCredentials,
  BrokerProfile,
  Funds,
  ModifyOrderRequest,
  Order,
  OrderRequest,
  OrderResponse,
  OrderStatus,
  Position,
  Quote,
} from './brokerAdapter.interface';

/**
 * Groww's official trading API issues an access token from an API key +
 * secret pair generated in the Groww trading-API console. The user pastes
 * that key/secret into our "Connect Groww" form; we exchange it here and
 * only ever persist the resulting encrypted access token.
 *
 * Docs: https://groww.in/trade-api/docs — token exchange is
 * `POST /v1/token/api/access` (NOT `/v1/token/api/create`, which doesn't
 * exist and returns a 404 "route not found" from Groww's side). The
 * "API key + secret" approval flow requires the API key as a Bearer token
 * on the request, plus a `checksum` = SHA-256(apiSecret + timestamp) and
 * the same epoch-second `timestamp`, per Groww's "How to Generate a
 * Checksum" docs. This flow also requires the user to have approved the
 * key for API access from the Groww web console beforehand — an
 * unapproved key/secret pair will still fail here with a Groww-side error,
 * which is expected and not a bug in this code.
 */
export class GrowwAdapter extends BaseHttpAdapter implements BrokerAdapter {
  public readonly brokerName = 'groww';
  protected baseUrl = env.brokers.groww.baseUrl;

  constructor(
    private apiKey: string,
    private accessToken?: string,
  ) {
    super();
  }

  private authHeaders() {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  private static buildChecksum(apiSecret: string, timestamp: string): string {
    return crypto.createHash('sha256').update(apiSecret + timestamp).digest('hex');
  }

  async connect(credentials: BrokerCredentials) {
    const apiKey = String(credentials.apiKey || this.apiKey);
    const apiSecret = String(credentials.apiSecret || '');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const checksum = GrowwAdapter.buildChecksum(apiSecret, timestamp);

    const data = await this.request<any>('/v1/token/api/access', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: { key_type: 'approval', checksum, timestamp },
    });

    this.apiKey = apiKey;
    this.accessToken = data.token || data.access_token;
    const profile = await this.getProfile();
    return { accessToken: this.accessToken as string, profile };
  }

  async getProfile(): Promise<BrokerProfile> {
    const data = await this.request<any>('/v1/user/profile', { headers: this.authHeaders() });
    const p = data.payload ?? data;
    return { clientId: p.clientId ?? p.client_id, name: p.name, email: p.email, broker: this.brokerName };
  }

  async getFunds(): Promise<Funds> {
    const data = await this.request<any>('/v1/margins/detail', { headers: this.authHeaders() });
    const m = data.payload ?? data;
    return {
      availableBalance: Number(m.clear_cash ?? m.available ?? 0),
      usedMargin: Number(m.used_margin ?? 0),
      totalBalance: Number(m.net_margin_used ?? 0),
      collateral: Number(m.collateral ?? 0),
      raw: data,
    };
  }

  async getPositions(): Promise<Position[]> {
    const data = await this.request<any>('/v1/positions/user', { headers: this.authHeaders() });
    const positions = data.payload?.positions ?? [];
    return positions.map((p: any) => ({
      tradingSymbol: p.trading_symbol,
      exchange: p.exchange,
      segment: mapGrowwSegment(p.segment),
      productType: p.product,
      quantity: Number(p.quantity ?? p.net_quantity ?? 0),
      averagePrice: Number(p.average_price ?? p.buy_avg_price ?? 0),
      lastTradedPrice: Number(p.last_price ?? 0),
      realizedPnl: Number(p.realised_pnl ?? 0),
      unrealizedPnl: Number(p.unrealised_pnl ?? 0),
      raw: p,
    }));
  }

  async getOrders(): Promise<Order[]> {
    const data = await this.request<any>('/v1/order/list', { headers: this.authHeaders() });
    return (data.payload?.order_list ?? []).map(mapGrowwOrder);
  }

  async placeOrder(order: OrderRequest): Promise<OrderResponse> {
    const data = await this.request<any>('/v1/order/create', {
      method: 'POST',
      headers: this.authHeaders(),
      body: {
        trading_symbol: order.tradingSymbol,
        exchange: order.exchange,
        segment: order.exchange === 'NFO' ? 'FNO' : 'CASH',
        product: order.productType,
        order_type: order.orderType,
        transaction_type: order.side,
        quantity: order.quantity,
        price: order.price ?? 0,
        trigger_price: order.triggerPrice ?? 0,
        validity: 'DAY',
      },
    });
    const p = data.payload ?? data;
    return { brokerOrderId: p.groww_order_id, status: p.order_status, raw: data };
  }

  async modifyOrder(orderId: string, order: ModifyOrderRequest): Promise<OrderResponse> {
    const data = await this.request<any>('/v1/order/modify', {
      method: 'POST',
      headers: this.authHeaders(),
      body: {
        groww_order_id: orderId,
        quantity: order.quantity,
        price: order.price,
        trigger_price: order.triggerPrice,
        order_type: order.orderType,
      },
    });
    return { brokerOrderId: orderId, status: data.payload?.order_status ?? 'MODIFIED', raw: data };
  }

  async cancelOrder(orderId: string): Promise<OrderResponse> {
    const data = await this.request<any>('/v1/order/cancel', {
      method: 'POST',
      headers: this.authHeaders(),
      body: { groww_order_id: orderId },
    });
    return { brokerOrderId: orderId, status: data.payload?.order_status ?? 'CANCELLED', raw: data };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const data = await this.request<any>(`/v1/order/detail/${orderId}`, { headers: this.authHeaders() });
    const p = data.payload ?? data;
    return {
      brokerOrderId: orderId,
      status: p.order_status,
      filledQuantity: Number(p.filled_quantity ?? 0),
      averagePrice: Number(p.average_fill_price ?? 0),
      raw: data,
    };
  }

  async getQuote(symbol: string): Promise<Quote> {
    const data = await this.request<any>('/v1/live_data/quote', {
      headers: this.authHeaders(),
      query: { trading_symbol: symbol, exchange: 'NSE', segment: 'CASH' },
    });
    const p = data.payload ?? data;
    return { tradingSymbol: symbol, ltp: Number(p.last_price ?? 0), raw: data };
  }
}

function mapGrowwSegment(segment: string): Position['segment'] {
  if (!segment) return 'equity';
  const s = segment.toUpperCase();
  if (s.includes('FNO')) return 'fno';
  if (s.includes('CURR')) return 'currency';
  if (s.includes('COMM')) return 'commodity';
  return 'equity';
}

function mapGrowwOrder(o: any): Order {
  return {
    brokerOrderId: o.groww_order_id,
    tradingSymbol: o.trading_symbol,
    exchange: o.exchange,
    segment: mapGrowwSegment(o.segment),
    side: o.transaction_type,
    orderType: o.order_type,
    productType: o.product,
    quantity: Number(o.quantity ?? 0),
    filledQuantity: Number(o.filled_quantity ?? 0),
    price: Number(o.price ?? 0),
    triggerPrice: Number(o.trigger_price ?? 0),
    averagePrice: Number(o.average_fill_price ?? 0),
    status: o.order_status,
    statusMessage: o.remark,
    placedAt: o.created_at,
    raw: o,
  };
}