import { Order, BrokerConnection } from '../../models';
import { OrderSegment } from '../../models/order.model';
import { ApiError } from '../../utils/ApiError';
import { buildBrokerAdapter } from '../brokers/adapters/brokerAdapter.factory';
import { OrderRequest } from '../brokers/adapters/brokerAdapter.interface';
import { markSessionExpired } from '../brokers/broker.service';
import { mapBrokerStatus, normalizeProductType } from '../brokers/brokerSync.service';
import { logger } from '../../utils/logger';

export interface PlaceOrderContext {
  strategyId?: string;
}

/**
 * Places one real order with the broker and returns the resulting `Order`
 * row — successful or not. Deliberately NOT a "fire and forget": the Order
 * row is created with status `CREATED` BEFORE the broker call goes out, so
 * that even if the process crashes mid-call or the broker call times out
 * without a clear success/failure, there's a durable record that an attempt
 * was made (visible to the user, and to the next syncOrders() cycle, which
 * will reconcile it against the broker's own order book).
 *
 * On failure this does NOT throw — it returns the Order row with status
 * `REJECTED` and `statusMessage` set, so callers (liveEngine.ts) can check
 * `order.status` rather than needing try/catch, and a rejected order still
 * leaves a row behind instead of vanishing.
 */
export async function placeOrder(
  connection: BrokerConnection,
  request: OrderRequest & { segment: OrderSegment },
  context: PlaceOrderContext = {},
): Promise<Order> {
  const orderRow = await Order.create({
    userId: connection.userId,
    brokerConnectionId: connection.id,
    broker: connection.broker,
    strategyId: context.strategyId ?? null,
    exchange: request.exchange,
    segment: request.segment,
    tradingSymbol: request.tradingSymbol,
    side: request.side,
    orderType: request.orderType,
    productType: normalizeProductType(request.productType),
    quantity: request.quantity,
    price: request.price ?? null,
    triggerPrice: request.triggerPrice ?? null,
    status: 'CREATED',
  });

  const adapter = buildBrokerAdapter(connection);

  try {
    const response = await adapter.placeOrder(request);
    await orderRow.update({
      brokerOrderId: response.brokerOrderId,
      // Conservative: syncOrders() (running every sync cycle, see
      // brokerSync.worker.ts) will overwrite this with the broker's real
      // current status — OPEN/FILLED/REJECTED/etc — within moments. Until
      // then this just records "the broker accepted the request", which
      // mapBrokerStatus treats as SUBMITTED for any status text it doesn't
      // recognize as a clearer terminal state.
      status: mapBrokerStatus(response.status),
      statusMessage: response.status,
      placedAt: new Date(),
      raw: (response.raw as Record<string, unknown>) ?? null,
    });
    logger.info(
      `Order ${orderRow.id} placed with ${connection.broker}: ${request.side} ${request.quantity} ${request.tradingSymbol} ` +
        `(brokerOrderId=${response.brokerOrderId}, status=${response.status})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Order placement failed';
    await orderRow.update({ status: 'REJECTED', statusMessage: message });
    logger.error(
      `Order ${orderRow.id} REJECTED by ${connection.broker}: ${request.side} ${request.quantity} ${request.tradingSymbol} — ${message}`,
    );
    if (err instanceof ApiError && err.errorCode === 'SESSION_EXPIRED') {
      // The order is already correctly recorded as REJECTED above — this
      // additionally flips the connection itself so nothing else (another
      // strategy, a manual order) keeps trying against a session we now
      // know for certain is dead, instead of each one discovering it
      // independently one rejected order at a time.
      await markSessionExpired(connection);
    }
  }

  return orderRow;
}
