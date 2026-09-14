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

export interface BrokerAdapter {
  readonly brokerName: string;

  /** Exchanges auth artifacts (request token / API key+secret) for a usable access token */
  connect(credentials: BrokerCredentials): Promise<{ accessToken: string; refreshToken?: string; profile: BrokerProfile }>;

  getProfile(): Promise<BrokerProfile>;
  getFunds(): Promise<Funds>;
  getPositions(): Promise<Position[]>;
  getOrders(): Promise<Order[]>;

  placeOrder(order: OrderRequest): Promise<OrderResponse>;
  modifyOrder(orderId: string, order: ModifyOrderRequest): Promise<OrderResponse>;
  cancelOrder(orderId: string): Promise<OrderResponse>;
  getOrderStatus(orderId: string): Promise<OrderStatus>;

  getQuote(symbol: string): Promise<Quote>;
}
