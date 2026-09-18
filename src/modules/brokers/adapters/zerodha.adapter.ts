import * as brokerService from '../brokerService.client';
import {
  BrokerAdapter,
  BrokerCredentials,
  BrokerProfile,
  Candle,
  Funds,
  HistoricalDataParams,
  Holding,
  ModifyOrderRequest,
  Order,
  OrderRequest,
  OrderResponse,
  OrderStatus,
  Position,
  Quote,
} from './brokerAdapter.interface';

/**
 * Zerodha Kite Connect uses a redirect-based login flow:
 *   1. Frontend sends the user to the URL from `buildLoginUrl()`
 *   2. User logs into Kite directly on Zerodha's own domain (2FA handled by Zerodha)
 *   3. Zerodha redirects back to our callback with a `request_token`
 *   4. We exchange `request_token` + `api_secret` for an `access_token`
 *
 * We never see the user's Zerodha password/PIN/TOTP.
 *
 * All actual API interaction — including the request_token exchange and the
 * login-url construction itself — happens in jestatp-broker-service via the
 * official `kiteconnect` SDK; this class just forwards calls there.
 */
export class ZerodhaAdapter implements BrokerAdapter {
  public readonly brokerName = 'zerodha';

  constructor(
    private apiKey: string,
    private apiSecret: string,
    private accessToken?: string,
  ) { }

  static async buildLoginUrl(apiKey: string): Promise<string> {
    return brokerService.getZerodhaLoginUrl(apiKey);
  }

  private credentials(): BrokerCredentials {
    return { apiKey: this.apiKey, accessToken: this.accessToken };
  }

  async connect(credentials: BrokerCredentials) {
    const requestToken = String(credentials.requestToken || '');
    const { accessToken, profile } = await brokerService.connectBroker('zerodha', {
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      requestToken,
    });
    this.accessToken = accessToken;
    return { accessToken, profile };
  }

  getProfile(): Promise<BrokerProfile> {
    return brokerService.getBrokerProfile('zerodha', this.credentials());
  }

  getFunds(): Promise<Funds> {
    return brokerService.getBrokerFunds('zerodha', this.credentials());
  }

  getPositions(): Promise<Position[]> {
    return brokerService.getBrokerPositions('zerodha', this.credentials());
  }

  getHoldings(): Promise<Holding[]> {
    return brokerService.getBrokerHoldings('zerodha', this.credentials());
  }

  getOrders(): Promise<Order[]> {
    return brokerService.getBrokerOrders('zerodha', this.credentials());
  }

  placeOrder(order: OrderRequest): Promise<OrderResponse> {
    return brokerService.placeBrokerOrder('zerodha', this.credentials(), order);
  }

  modifyOrder(orderId: string, order: ModifyOrderRequest): Promise<OrderResponse> {
    return brokerService.modifyBrokerOrder('zerodha', this.credentials(), orderId, order);
  }

  cancelOrder(orderId: string): Promise<OrderResponse> {
    return brokerService.cancelBrokerOrder('zerodha', this.credentials(), orderId);
  }

  getOrderStatus(orderId: string): Promise<OrderStatus> {
    return brokerService.getBrokerOrderStatus('zerodha', this.credentials(), orderId);
  }

  getQuote(symbol: string, exchange = 'NSE'): Promise<Quote> {
    return brokerService.getBrokerQuote('zerodha', this.credentials(), symbol, exchange);
  }

  getHistoricalData(params: HistoricalDataParams): Promise<Candle[]> {
    return brokerService.getBrokerHistoricalData('zerodha', this.credentials(), params);
  }
}