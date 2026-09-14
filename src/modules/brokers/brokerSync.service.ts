import { sequelize, Order, Position, Fund, BrokerConnection } from '../../models';
import { OrderSegment } from '../../models/order.model';
import { PositionSegment } from '../../models/position.model';
import { buildBrokerAdapter } from './adapters/brokerAdapter.factory';
import { logger } from '../../utils/logger';

/** Product type differs slightly per broker; normalize CNC/MIS/NRML-ish values. */
function normalizeProductType(p: string): 'CNC' | 'MIS' | 'NRML' {
  const up = (p || '').toUpperCase();
  if (up.includes('MIS') || up.includes('INTRADAY')) return 'MIS';
  if (up.includes('NRML') || up.includes('CARRYFORWARD') || up.includes('CF')) return 'NRML';
  return 'CNC';
}

function mapBrokerStatus(status: string): Order['status'] {
  const s = (status || '').toUpperCase();
  if (s.includes('REJECT')) return 'REJECTED';
  if (s.includes('CANCEL')) return 'CANCELLED';
  if (s.includes('COMPLETE') || s === 'FILLED') return 'FILLED';
  if (s.includes('PARTIAL')) return 'PARTIALLY_FILLED';
  if (s.includes('OPEN') || s.includes('TRIGGER') || s.includes('PENDING')) return 'OPEN';
  return 'SUBMITTED';
}

/**
 * Pulls the live order book from the broker and upserts it atomically.
 * This is the ONLY place order-sync logic lives — both the background worker
 * (scheduled + on-demand jobs) and (if ever needed) a direct call use this.
 */
export async function syncOrders(connection: BrokerConnection): Promise<number> {
  const adapter = buildBrokerAdapter(connection);
  const brokerOrders = await adapter.getOrders();

  await sequelize.transaction(async (t) => {
    for (const o of brokerOrders) {
      await Order.upsert(
        {
          userId: connection.userId,
          brokerConnectionId: connection.id,
          broker: connection.broker,
          brokerOrderId: o.brokerOrderId,
          exchange: o.exchange,
          segment: o.segment as OrderSegment,
          tradingSymbol: o.tradingSymbol,
          side: o.side,
          orderType: o.orderType,
          productType: normalizeProductType(o.productType),
          quantity: o.quantity,
          filledQuantity: o.filledQuantity,
          price: o.price ?? null,
          triggerPrice: o.triggerPrice ?? null,
          averagePrice: o.averagePrice ?? null,
          status: mapBrokerStatus(o.status),
          statusMessage: o.statusMessage ?? null,
          placedAt: o.placedAt ? new Date(o.placedAt) : null,
          raw: (o.raw as Record<string, unknown>) ?? null,
        },
        { transaction: t },
      );
    }
  });

  return brokerOrders.length;
}

export async function syncPositions(connection: BrokerConnection): Promise<number> {
  const adapter = buildBrokerAdapter(connection);
  const brokerPositions = await adapter.getPositions();

  await sequelize.transaction(async (t) => {
    for (const p of brokerPositions) {
      await Position.upsert(
        {
          userId: connection.userId,
          brokerConnectionId: connection.id,
          broker: connection.broker,
          exchange: p.exchange,
          segment: p.segment as PositionSegment,
          tradingSymbol: p.tradingSymbol,
          productType: p.productType,
          quantity: p.quantity,
          averagePrice: p.averagePrice,
          lastTradedPrice: p.lastTradedPrice ?? null,
          realizedPnl: p.realizedPnl ?? 0,
          unrealizedPnl: p.unrealizedPnl ?? 0,
          raw: (p.raw as Record<string, unknown>) ?? null,
          syncedAt: new Date(),
        },
        { transaction: t },
      );
    }
  });

  return brokerPositions.length;
}

export async function syncFunds(connection: BrokerConnection): Promise<void> {
  const adapter = buildBrokerAdapter(connection);
  const funds = await adapter.getFunds();

  await Fund.upsert({
    userId: connection.userId,
    brokerConnectionId: connection.id,
    broker: connection.broker,
    availableBalance: funds.availableBalance,
    usedMargin: funds.usedMargin,
    totalBalance: funds.totalBalance,
    collateral: funds.collateral,
    raw: (funds.raw as Record<string, unknown>) ?? null,
    syncedAt: new Date(),
  });
}

/** Runs all three syncs for one connection and stamps `lastSyncedAt`. Used by both the queue worker and the on-demand sync endpoint's fallback path. */
export async function syncConnectionFully(connection: BrokerConnection): Promise<void> {
  const results = await Promise.allSettled([syncOrders(connection), syncPositions(connection), syncFunds(connection)]);

  const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  if (failures.length > 0) {
    logger.error(
      `Partial broker sync failure for connection ${connection.id} (${connection.broker}): ${failures
        .map((f) => f.reason?.message || f.reason)
        .join(' | ')}`,
    );
  }

  await connection.update({ lastSyncedAt: new Date() });

  if (failures.length === results.length) {
    // Everything failed — surface it so BullMQ marks the job failed and retries with backoff.
    throw failures[0].reason;
  }
}
