import { sequelize, BrokerConnection, AuditLog } from '../../models';
import { BrokerName } from '../../models/brokerConnection.model';
import { ApiError } from '../../utils/ApiError';
import { encrypt } from '../../utils/crypto';
import { buildAdapterForConnect, buildBrokerAdapter } from './adapters/brokerAdapter.factory';
import { ZerodhaAdapter } from './adapters/zerodha.adapter';
import { Candle, HistoricalDataParams } from './adapters/brokerAdapter.interface';

export const SUPPORTED_BROKERS: { broker: BrokerName; name: string; authType: 'token' | 'oauth' }[] = [
  { broker: 'dhan', name: 'Dhan', authType: 'token' },
  { broker: 'zerodha', name: 'Zerodha', authType: 'oauth' },
  { broker: 'groww', name: 'Groww', authType: 'token' },
];

export async function listConnections(userId: string) {
  return BrokerConnection.findAll({
    where: { userId },
    attributes: { exclude: ['apiKeyEncrypted', 'apiSecretEncrypted', 'accessTokenEncrypted', 'refreshTokenEncrypted'] },
  });
}

async function upsertConnectionWithAudit(
  userId: string,
  broker: BrokerName,
  fields: Partial<{
    clientId: string;
    apiKeyEncrypted: string;
    apiSecretEncrypted: string;
    accessTokenEncrypted: string;
  }>,
) {
  return sequelize.transaction(async (t) => {
    const [connection] = await BrokerConnection.findOrCreate({
      where: { userId, broker },
      defaults: { userId, broker, status: 'pending' },
      transaction: t,
    });
    await connection.update({ ...fields, status: 'connected', lastSyncedAt: new Date() }, { transaction: t });
    await AuditLog.create(
      { userId, action: 'broker.connect', entityType: 'broker_connection', entityId: connection.id, metadata: { broker } },
      { transaction: t },
    );
    return connection;
  });
}

/** Dhan: user pastes clientId + accessToken generated from Dhan's own dashboard. */
export async function connectDhan(userId: string, clientId: string, accessToken: string) {
  const adapter = buildAdapterForConnect('dhan', { clientId });
  const { profile } = await adapter.connect({ clientId, accessToken });

  return upsertConnectionWithAudit(userId, 'dhan', {
    clientId: profile.clientId,
    accessTokenEncrypted: encrypt(accessToken),
  });
}

/** Zerodha step 1: build the official Kite login URL the frontend should redirect the user to. */
export function getZerodhaLoginUrl(apiKey: string) {
  return ZerodhaAdapter.buildLoginUrl(apiKey);
}

/** Zerodha step 2: after the user authorizes on Zerodha's domain and we get `request_token` back. */
export async function connectZerodha(userId: string, apiKey: string, apiSecret: string, requestToken: string) {
  const adapter = buildAdapterForConnect('zerodha', { apiKey, apiSecret });
  const { accessToken, profile } = await adapter.connect({ requestToken });

  return upsertConnectionWithAudit(userId, 'zerodha', {
    clientId: profile.clientId,
    apiKeyEncrypted: encrypt(apiKey),
    apiSecretEncrypted: encrypt(apiSecret),
    accessTokenEncrypted: encrypt(accessToken),
  });
}

/** Groww: user supplies API key + secret generated from Groww's trading-API console. */
export async function connectGroww(userId: string, apiKey: string, apiSecret: string) {
  const adapter = buildAdapterForConnect('groww', { apiKey });
  const { accessToken, profile } = await adapter.connect({ apiKey, apiSecret });

  return upsertConnectionWithAudit(userId, 'groww', {
    clientId: profile.clientId,
    apiKeyEncrypted: encrypt(apiKey),
    accessTokenEncrypted: encrypt(accessToken),
  });
}

export async function disconnectBroker(userId: string, broker: BrokerName) {
  const connection = await BrokerConnection.findOne({ where: { userId, broker } });
  if (!connection) throw ApiError.notFound(`No ${broker} connection found`);

  await sequelize.transaction(async (t) => {
    await connection.update(
      { status: 'revoked', accessTokenEncrypted: null, refreshTokenEncrypted: null },
      { transaction: t },
    );
    await AuditLog.create(
      { userId, action: 'broker.disconnect', entityType: 'broker_connection', entityId: connection.id, metadata: { broker } },
      { transaction: t },
    );
  });

  return connection;
}

export async function getActiveConnection(userId: string, broker: BrokerName) {
  const connection = await BrokerConnection.findOne({ where: { userId, broker, status: 'connected' } });
  if (!connection) {
    throw ApiError.badRequest(`No active ${broker} connection. Please connect your ${broker} account first.`);
  }
  return connection;
}

/**
 * Fetches real OHLCV candles from the given broker for the given instrument —
 * the single entry point the chart preview and the backtest engine both use,
 * so there is exactly one code path that talks to a broker for historical data.
 */
export async function getHistoricalCandles(
  userId: string,
  broker: BrokerName,
  params: HistoricalDataParams,
): Promise<Candle[]> {
  const connection = await getActiveConnection(userId, broker);
  const adapter = buildBrokerAdapter(connection);
  return adapter.getHistoricalData(params);
}