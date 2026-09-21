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
 * Groww's official trading API issues an access token from an API key +
 * secret pair generated in the Groww trading-API console. The user pastes
 * that key/secret into our "Connect Groww" form; we exchange it via
 * jestatp-broker-service (official `growwapi` SDK) and only ever persist
 * the resulting encrypted access token.
 *
 * All actual API interaction happens in jestatp-broker-service — this class
 * just forwards calls there with the credentials Node already holds
 * decrypted.
 */
export class GrowwAdapter implements BrokerAdapter {
  public readonly brokerName = 'groww';

  constructor(
    private apiKey: string,
    private accessToken?: string,
  ) { }

  private credentials(): BrokerCredentials {
    return { accessToken: this.accessToken };
  }

  async connect(credentials: BrokerCredentials) {
    const apiKey = String(credentials.apiKey || this.apiKey);
    const apiSecret = String(credentials.apiSecret || '');
    const { accessToken, profile } = await brokerService.connectBroker('groww', { apiKey, apiSecret });
    this.apiKey = apiKey;
    this.accessToken = accessToken;
    return { accessToken, profile };
  }

  getProfile(): Promise<BrokerProfile> {
    return brokerService.getBrokerProfile('groww', this.credentials());
  }

  getFunds(): Promise<Funds> {
    return brokerService.getBrokerFunds('groww', this.credentials());
  }

  getPositions(): Promise<Position[]> {
    return brokerService.getBrokerPositions('groww', this.credentials());
  }

  getHoldings(): Promise<Holding[]> {
    return brokerService.getBrokerHoldings('groww', this.credentials());
  }

  getOrders(): Promise<Order[]> {
    return brokerService.getBrokerOrders('groww', this.credentials());
  }

  placeOrder(order: OrderRequest): Promise<OrderResponse> {
    return brokerService.placeBrokerOrder('groww', this.credentials(), order);
  }

  modifyOrder(orderId: string, order: ModifyOrderRequest): Promise<OrderResponse> {
    return brokerService.modifyBrokerOrder('groww', this.credentials(), orderId, order);
  }

  cancelOrder(orderId: string): Promise<OrderResponse> {
    return brokerService.cancelBrokerOrder('groww', this.credentials(), orderId);
  }

  getOrderStatus(orderId: string): Promise<OrderStatus> {
    return brokerService.getBrokerOrderStatus('groww', this.credentials(), orderId);
  }

  getQuote(symbol: string): Promise<Quote> {
    return brokerService.getBrokerQuote('groww', this.credentials(), symbol);
  }

  getHistoricalData(params: HistoricalDataParams): Promise<Candle[]> {
    return brokerService.getBrokerHistoricalData('groww', this.credentials(), params);
  }

  getOptionChainExpiries(underlying: IndexUnderlying): Promise<string[]> {
    return brokerService.getBrokerOptionChainExpiries('groww', this.credentials(), underlying);
  }

  getOptionChain(underlying: IndexUnderlying, expiry?: string): Promise<OptionChain> {
    return brokerService.getBrokerOptionChain('groww', this.credentials(), underlying, expiry);
  }
}