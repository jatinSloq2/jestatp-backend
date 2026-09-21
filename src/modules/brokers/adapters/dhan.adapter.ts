import * as brokerService from '../brokerService.client';
import {
  BrokerAdapter,
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
} from './brokerAdapter.interface';

/**
 * Dhan uses a long-lived "access token" generated from the Dhan web console
 * (Profile → DhanHQ Trading APIs) rather than a redirect OAuth dance. The
 * user pastes their `clientId` + `accessToken` (and optionally `apiKey` if
 * using partner API) into our "Connect Dhan" form; we never see their Dhan
 * login password/OTP.
 *
 * All actual API interaction happens in jestatp-broker-service via the
 * official `dhanhq` SDK — this class just forwards calls there with the
 * credentials Node already holds decrypted.
 */
export class DhanAdapter implements BrokerAdapter {
  public readonly brokerName = 'dhan';

  private accessToken: string;
  private clientId: string;

  constructor(accessToken: string, clientId: string) {
    this.accessToken = accessToken;
    this.clientId = clientId;
  }

  private credentials(): BrokerCredentials {
    return { clientId: this.clientId, accessToken: this.accessToken };
  }

  async connect(credentials: BrokerCredentials) {
    this.accessToken = String(credentials.accessToken || '');
    this.clientId = String(credentials.clientId || '');
    const { accessToken, profile } = await brokerService.connectBroker('dhan', this.credentials());
    return { accessToken, profile };
  }

  getProfile(): Promise<BrokerProfile> {
    return brokerService.getBrokerProfile('dhan', this.credentials());
  }

  getFunds(): Promise<Funds> {
    return brokerService.getBrokerFunds('dhan', this.credentials());
  }

  getPositions(): Promise<Position[]> {
    return brokerService.getBrokerPositions('dhan', this.credentials());
  }

  getHoldings(): Promise<Holding[]> {
    return brokerService.getBrokerHoldings('dhan', this.credentials());
  }

  getOrders(): Promise<Order[]> {
    return brokerService.getBrokerOrders('dhan', this.credentials());
  }

  placeOrder(order: OrderRequest): Promise<OrderResponse> {
    return brokerService.placeBrokerOrder('dhan', this.credentials(), order);
  }

  modifyOrder(orderId: string, order: ModifyOrderRequest): Promise<OrderResponse> {
    return brokerService.modifyBrokerOrder('dhan', this.credentials(), orderId, order);
  }

  cancelOrder(orderId: string): Promise<OrderResponse> {
    return brokerService.cancelBrokerOrder('dhan', this.credentials(), orderId);
  }

  getOrderStatus(orderId: string): Promise<OrderStatus> {
    return brokerService.getBrokerOrderStatus('dhan', this.credentials(), orderId);
  }

  getQuote(symbol: string, exchange = 'NSE'): Promise<Quote> {
    return brokerService.getBrokerQuote('dhan', this.credentials(), symbol, exchange);
  }

  getHistoricalData(params: HistoricalDataParams): Promise<Candle[]> {
    return brokerService.getBrokerHistoricalData('dhan', this.credentials(), params);
  }

  getOptionChainExpiries(underlying: IndexUnderlying): Promise<string[]> {
    return brokerService.getBrokerOptionChainExpiries('dhan', this.credentials(), underlying);
  }

  getOptionChain(underlying: IndexUnderlying, expiry?: string): Promise<OptionChain> {
    return brokerService.getBrokerOptionChain('dhan', this.credentials(), underlying, expiry);
  }
}