/**
 * Common broker abstraction.
 *
 * The strategy / trading engine must NEVER talk to Dhan/Zerodha/Groww directly.
 * Everything goes through this interface so a new broker can be plugged in
 * later (Angel One, Upstox, FYERS, ...) without touching the rest of the app.
 */

export interface BrokerCredentials {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  /** Broker-specific extra fields (e.g. Zerodha `request_token`) */
  [key: string]: unknown;
}

export interface BrokerProfile {
  clientId: string;
  name: string;
  email?: string;
  broker: string;
}

export interface Funds {
  availableBalance: number;
  usedMargin: number;
  totalBalance: number;
  collateral: number;
  raw?: unknown;
}

export interface Position {
  tradingSymbol: string;
  exchange: string;
  segment: 'equity' | 'fno' | 'currency' | 'commodity';
  productType: string;
  quantity: number;
  averagePrice: number;
  lastTradedPrice?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  raw?: unknown;
}

/** A long-term equity delivery holding sitting in the user's DEMAT account — distinct from an intraday/carry-forward Position. */
export interface Holding {
  tradingSymbol: string;
  isin?: string;
  exchange: string;
  quantity: number;
  averagePrice: number;
  /** Not every broker's holdings endpoint returns a live price — undefined here means "source it from the live feed instead". */
  lastTradedPrice?: number;
  raw?: unknown;
}

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
export type ProductType = 'CNC' | 'MIS' | 'NRML';

export interface Order {
  brokerOrderId: string;
  tradingSymbol: string;
  exchange: string;
  segment: 'equity' | 'fno' | 'currency' | 'commodity';
  side: OrderSide;
  orderType: OrderType;
  productType: ProductType;
  quantity: number;
  filledQuantity: number;
  price?: number;
  triggerPrice?: number;
  averagePrice?: number;
  status: string;
  statusMessage?: string;
  placedAt?: string;
  raw?: unknown;
}

export interface OrderRequest {
  tradingSymbol: string;
  exchange: string;
  side: OrderSide;
  orderType: OrderType;
  productType: ProductType;
  quantity: number;
  price?: number;
  triggerPrice?: number;
}

export interface ModifyOrderRequest {
  quantity?: number;
  price?: number;
  triggerPrice?: number;
  orderType?: OrderType;
}

export interface OrderResponse {
  brokerOrderId: string;
  status: string;
  raw?: unknown;
}

export interface OrderStatus {
  brokerOrderId: string;
  status: string;
  filledQuantity: number;
  averagePrice?: number;
  raw?: unknown;
}

export interface Quote {
  tradingSymbol: string;
  ltp: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  raw?: unknown;
}

/** One OHLCV candle. `timestamp` is epoch milliseconds (UTC). */
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type HistoricalTimeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '1d';

export interface HistoricalDataParams {
  tradingSymbol: string;
  exchange: string;
  segment?: 'equity' | 'fno' | 'currency' | 'commodity';
  timeframe: HistoricalTimeframe;
  /** Inclusive range, both in UTC. */
  from: Date;
  to: Date;
}

export type IndexUnderlying = 'NIFTY' | 'BANKNIFTY' | 'FINNIFTY' | 'MIDCPNIFTY' | 'SENSEX';

export interface OptionLeg {
  tradingSymbol: string | null;
  exchange: string;
  ltp: number;
  bid: number;
  ask: number;
  oi: number;
  volume: number;
  iv?: number;
  lotSize: number | null;
}

export interface OptionChainStrike {
  strike: number;
  call: OptionLeg | null;
  put: OptionLeg | null;
}

export interface OptionChain {
  underlying: string;
  exchange: string;
  expiry: string;
  underlyingLtp: number;
  strikes: OptionChainStrike[];
}

export interface BrokerAdapter {
  readonly brokerName: string;

  /** Exchanges auth artifacts (request token / API key+secret) for a usable access token */
  connect(credentials: BrokerCredentials): Promise<{ accessToken: string; refreshToken?: string; profile: BrokerProfile }>;

  getProfile(): Promise<BrokerProfile>;
  getFunds(): Promise<Funds>;
  getPositions(): Promise<Position[]>;
  getHoldings(): Promise<Holding[]>;
  getOrders(): Promise<Order[]>;

  placeOrder(order: OrderRequest): Promise<OrderResponse>;
  modifyOrder(orderId: string, order: ModifyOrderRequest): Promise<OrderResponse>;
  cancelOrder(orderId: string): Promise<OrderResponse>;
  getOrderStatus(orderId: string): Promise<OrderStatus>;

  getQuote(symbol: string, exchange?: string): Promise<Quote>;

  /** Historical OHLCV candles — the data source for chart previews and backtesting. */
  getHistoricalData(params: HistoricalDataParams): Promise<Candle[]>;

  /** Expiry dates (YYYY-MM-DD) currently listed for this index underlying. */
  getOptionChainExpiries(underlying: IndexUnderlying): Promise<string[]>;

  /** Full option chain (all strikes, CE+PE) for one index underlying/expiry. Omit expiry for the nearest one. */
  getOptionChain(underlying: IndexUnderlying, expiry?: string): Promise<OptionChain>;
}