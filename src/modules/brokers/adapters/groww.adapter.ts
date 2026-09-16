import crypto from 'crypto';
import { env } from '../../../config/env';
import { ApiError } from '../../../utils/ApiError';
import { BaseHttpAdapter } from './baseHttp.adapter';
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

/**
 * Our platform-wide timeframe -> Groww's `candle_interval` query value.
 * Groww's current historical endpoint (GET /v1/historical/candles)
 * documents this as e.g. "5minute"; there's no native 3m/30m bucket, so
 * those fall back to the closest supported one.
 */
const GROWW_INTERVAL_MAP: Record<HistoricalDataParams['timeframe'], string> = {
  '1m': '1minute',
  '3m': '5minute',
  '5m': '5minute',
  '15m': '15minute',
  '30m': '30minute',
  '1h': '60minute',
  '1d': '1day',
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function formatGrowwDateTime(d: Date): string {
  // Groww's docs show start_time/end_time as plain "yyyy-MM-dd HH:mm:ss"
  // with no offset — that's exchange (IST) wall-clock time, same convention
  // as every other NSE/BSE broker API, so shift from UTC before formatting.
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())}`;
}

/**
 * The `/v1/historical/candles` response now returns each candle's timestamp
 * as an IST wall-clock string ("yyyy-MM-ddTHH:mm:ss" or "yyyy-MM-dd HH:mm:ss"),
 * not epoch seconds. Parse it as IST and convert to a UTC epoch-ms instant,
 * mirroring formatGrowwDateTime's offset in reverse.
 */
function parseGrowwCandleTimestamp(value: string | number): number {
  if (typeof value === 'number') return value * 1000; // defensive: older/alt responses used epoch seconds
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const [datePart, timePart] = normalized.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = (timePart ?? '00:00:00').split(':').map(Number);
  const istAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second ?? 0);
  return istAsUtcMs - IST_OFFSET_MS;
}

/** 8-20 char alphanumeric string with at most two hyphens, as Groww's `order_reference_id` requires. */
function generateGrowwOrderReferenceId(): string {
  return `AT-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
}

/**
 * Groww's official trading API issues an access token from an API key +
 * secret pair generated in the Groww trading-API console. The user pastes
 * that key/secret into our "Connect Groww" form; we exchange it here and
 * only ever persist the resulting encrypted access token.
 *
 * Docs: https://groww.in/trade-api/docs/curl — token exchange is
 * `POST /v1/token/api/access` with the API key as a Bearer token on the
 * request, plus a `checksum` = SHA-256(apiSecret + timestamp) and the same
 * epoch-second `timestamp`, per Groww's "How to Generate a Checksum" docs.
 * Every authenticated Groww request also requires an `X-API-VERSION: 1.0`
 * header — omitting it is undocumented-but-observed to still work today,
 * but we send it since Groww's docs mark it mandatory on every call.
 * This flow also requires the user to have approved the key for API access
 * from the Groww web console beforehand — an unapproved key/secret pair
 * will still fail here with a Groww-side error, which is expected and not
 * a bug in this code.
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
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'X-API-VERSION': '1.0',
    };
  }

  private static buildChecksum(apiSecret: string, timestamp: string): string {
    return crypto.createHash('sha256').update(apiSecret + timestamp).digest('hex');
  }

  /**
   * Several Groww order endpoints (modify/cancel/status) require a `segment`
   * query/body param, but our shared BrokerAdapter interface doesn't carry
   * segment alongside a bare orderId. CASH covers the overwhelming majority
   * of orders; if Groww reports the order doesn't exist in that segment
   * (error code GA004), retry once against FNO before giving up.
   */
  private async withSegmentFallback<T>(attempt: (segment: 'CASH' | 'FNO') => Promise<T>): Promise<T> {
    try {
      return await attempt('CASH');
    } catch (err) {
      const isNotFound = err instanceof ApiError && (err.details as any)?.error?.code === 'GA004';
      if (!isNotFound) throw err;
      return attempt('FNO');
    }
  }

  async connect(credentials: BrokerCredentials) {
    const apiKey = String(credentials.apiKey || this.apiKey);
    const apiSecret = String(credentials.apiSecret || '');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const checksum = GrowwAdapter.buildChecksum(apiSecret, timestamp);

    const data = await this.request<any>('/v1/token/api/access', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'X-API-VERSION': '1.0' },
      body: { key_type: 'approval', checksum, timestamp },
    });

    this.apiKey = apiKey;
    this.accessToken = data.token || data.access_token;
    const profile = await this.getProfile();
    return { accessToken: this.accessToken as string, profile };
  }

  async getProfile(): Promise<BrokerProfile> {
    // Docs: GET /v1/user/detail (NOT /v1/user/profile, which 404s). The
    // payload has no dedicated display-name/email fields — just the UCC
    // (Unique Client Code) and a vendor_user_id — so `ucc` doubles as both
    // clientId and name here, same pattern used for Dhan's adapter.
    const data = await this.request<any>('/v1/user/detail', { headers: this.authHeaders() });
    const p = data.payload ?? data;
    return {
      clientId: p.ucc ?? p.vendor_user_id,
      name: p.ucc ?? p.vendor_user_id,
      broker: this.brokerName,
    };
  }

  async getFunds(): Promise<Funds> {
    // Docs: GET /v1/margins/detail/user (NOT /v1/margins/detail, which
    // 404s with Groww's generic "404 page not found" — the exact symptom
    // that was surfacing through this endpoint before this fix). The
    // payload has no "available"/"used_margin"/"collateral" fields; the
    // real field names are clear_cash, net_margin_used, collateral_used
    // and collateral_available.
    const data = await this.request<any>('/v1/margins/detail/user', { headers: this.authHeaders() });
    const m = data.payload ?? data;
    const clearCash = Number(m.clear_cash ?? 0);
    const netMarginUsed = Number(m.net_margin_used ?? 0);
    return {
      availableBalance: clearCash,
      usedMargin: netMarginUsed,
      // Groww doesn't return a single "total account value" field; the
      // closest equivalent is what's still free plus what's already
      // deployed as margin.
      totalBalance: clearCash + netMarginUsed,
      collateral: Number(m.collateral_available ?? 0),
      raw: data,
    };
  }

  async getPositions(): Promise<Position[]> {
    const data = await this.request<any>('/v1/positions/user', { headers: this.authHeaders() });
    const positions = data.payload?.positions ?? [];
    // Docs: GET /v1/positions/user — the response has no unrealised_pnl or
    // last_price field at all (those come from the separate live-data
    // endpoints), and "average price" here is `net_price`, not
    // `average_price`/`buy_avg_price` (neither of which Groww returns).
    return positions.map((p: any) => ({
      tradingSymbol: p.trading_symbol,
      exchange: p.exchange,
      segment: mapGrowwSegment(p.segment),
      productType: p.product,
      quantity: Number(p.quantity ?? 0),
      averagePrice: Number(p.net_price ?? 0),
      lastTradedPrice: undefined,
      realizedPnl: Number(p.realised_pnl ?? 0),
      unrealizedPnl: undefined,
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
        // Required by Groww's /v1/order/create (8-20 alphanumeric chars,
        // at most two hyphens) — the caller has no notion of this, so we
        // generate one ourselves purely to satisfy the broker's contract.
        order_reference_id: generateGrowwOrderReferenceId(),
      },
    });
    const p = data.payload ?? data;
    return { brokerOrderId: p.groww_order_id, status: p.order_status, raw: data };
  }

  async modifyOrder(orderId: string, order: ModifyOrderRequest): Promise<OrderResponse> {
    return this.withSegmentFallback(async (segment) => {
      const data = await this.request<any>('/v1/order/modify', {
        method: 'POST',
        headers: this.authHeaders(),
        body: {
          groww_order_id: orderId,
          segment, // required by Groww; see withSegmentFallback
          quantity: order.quantity,
          price: order.price,
          trigger_price: order.triggerPrice,
          order_type: order.orderType,
        },
      });
      return { brokerOrderId: orderId, status: data.payload?.order_status ?? 'MODIFIED', raw: data };
    });
  }

  async cancelOrder(orderId: string): Promise<OrderResponse> {
    return this.withSegmentFallback(async (segment) => {
      const data = await this.request<any>('/v1/order/cancel', {
        method: 'POST',
        headers: this.authHeaders(),
        body: { groww_order_id: orderId, segment }, // segment required by Groww; see withSegmentFallback
      });
      return { brokerOrderId: orderId, status: data.payload?.order_status ?? 'CANCELLED', raw: data };
    });
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    return this.withSegmentFallback(async (segment) => {
      const data = await this.request<any>(`/v1/order/detail/${orderId}`, {
        headers: this.authHeaders(),
        query: { segment }, // segment required by Groww; see withSegmentFallback
      });
      const p = data.payload ?? data;
      return {
        brokerOrderId: orderId,
        status: p.order_status,
        filledQuantity: Number(p.filled_quantity ?? 0),
        averagePrice: Number(p.average_fill_price ?? 0),
        raw: data,
      };
    });
  }

  async getQuote(symbol: string): Promise<Quote> {
    // Docs: GET /v1/live-data/quote (hyphen — /v1/live_data/quote 404s).
    const data = await this.request<any>('/v1/live-data/quote', {
      headers: this.authHeaders(),
      query: { trading_symbol: symbol, exchange: 'NSE', segment: 'CASH' },
    });
    const p = data.payload ?? data;
    return { tradingSymbol: symbol, ltp: Number(p.last_price ?? 0), raw: data };
  }

  async getHistoricalData(params: HistoricalDataParams): Promise<Candle[]> {
    const growwSymbol = `${params.exchange.toUpperCase()}-${params.tradingSymbol.toUpperCase()}`;
    const data = await this.request<any>('/v1/historical/candles', {
      headers: this.authHeaders(),
      query: {
        exchange: params.exchange.toUpperCase(),
        segment: params.segment === 'fno' ? 'FNO' : 'CASH',
        groww_symbol: growwSymbol,
        start_time: formatGrowwDateTime(params.from),
        end_time: formatGrowwDateTime(params.to),
        candle_interval: GROWW_INTERVAL_MAP[params.timeframe],
      },
    });
    const candles = (data.payload?.candles ?? data.candles ?? []) as (string | number)[][];
    // Each record is [timestamp (IST wall-clock string), open, high, low, close, volume, (open interest)].
    return candles.map((c) => ({
      timestamp: parseGrowwCandleTimestamp(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5] ?? 0),
    }));
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