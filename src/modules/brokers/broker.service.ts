import { sequelize, BrokerConnection, AuditLog } from '../../models';
import { BrokerName } from '../../models/brokerConnection.model';
import { ApiError } from '../../utils/ApiError';
import { encrypt } from '../../utils/crypto';
import { buildAdapterForConnect, buildBrokerAdapter } from './adapters/brokerAdapter.factory';
import { ZerodhaAdapter } from './adapters/zerodha.adapter';
import { Candle, HistoricalDataParams, IndexUnderlying } from './adapters/brokerAdapter.interface';
import { computeTokenExpiry } from './tokenExpiry';
import { raiseAlert } from '../alerts/alerting.service';

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
  const connectedAt = new Date();
  return sequelize.transaction(async (t) => {
    const [connection] = await BrokerConnection.findOrCreate({
      where: { userId, broker },
      defaults: { userId, broker, status: 'pending' },
      transaction: t,
    });
    await connection.update(
      {
        ...fields,
        status: 'connected',
        lastSyncedAt: connectedAt,
        // See tokenExpiry.ts for exactly what each broker's session lifetime
        // actually is (verified against current docs, not assumed) — this is
        // the proactive half of expiry handling; getActiveConnection below
        // is the reactive half (catches the broker's own "expired" error in
        // case this estimate is ever wrong).
        tokenExpiresAt: computeTokenExpiry(broker, connectedAt),
      },
      { transaction: t },
    );
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
export function getZerodhaLoginUrl(apiKey: string): Promise<string> {
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

/**
 * The single choke point every broker-facing call goes through
 * (backtests, live/paper strategy execution, manual order placement,
 * quotes) — which makes it the right place to enforce session expiry
 * rather than scattering the check across every caller.
 *
 * Two layers, deliberately: a `connected` row whose `tokenExpiresAt` has
 * already passed is caught HERE, proactively, before wasting an API call
 * on a token we already know is dead (see tokenExpiry.ts for how that's
 * computed per broker). But since that's an estimate, the broker's own
 * "session expired" error is also caught reactively wherever a broker call
 * actually happens (getHistoricalCandles, getQuote, orderPlacement.service.ts)
 * via markSessionExpired below — so a wrong estimate never leaves the
 * connection silently marked "connected" while every real call fails.
 */
export async function getActiveConnection(userId: string, broker: BrokerName) {
  const connection = await BrokerConnection.findOne({ where: { userId, broker, status: 'connected' } });
  if (!connection) {
    throw ApiError.badRequest(`No active ${broker} connection. Please connect your ${broker} account first.`);
  }

  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() <= Date.now()) {
    await markSessionExpired(connection);
    throw ApiError.badRequest(
      `Your ${broker} session has expired. ${broker} sessions don't last forever — please reconnect your account to continue.`,
    );
  }

  return connection;
}

/**
 * Flips a connection to `expired` and tells the user — both a DB-recorded
 * alert (shows in the bell/`/alerts`) and, for anyone actively trading live
 * through this connection, an immediate email, since a strategy that can no
 * longer place live orders because of a dead session needs attention now,
 * not next time someone happens to check the dashboard.
 */
export async function markSessionExpired(connection: BrokerConnection): Promise<void> {
  if (connection.status === 'expired') return; // already recorded, avoid duplicate alerts on repeated calls
  await connection.update({ status: 'expired' });
  await raiseAlert({
    userId: connection.userId,
    severity: 'warning',
    type: 'broker_session_expired',
    message: `Your ${connection.broker} session has expired and needs to be reconnected before trading can continue.`,
    metadata: { broker: connection.broker, connectionId: connection.id },
  });
}

/**
 * Records whether this connection's broker plan currently covers live/
 * historical market data, so the frontend header can show a "purchase the
 * data plan" notice without re-hitting the broker on every page load.
 * Stored in `meta` (rather than a dedicated column) since it's a soft,
 * best-effort signal we're happy to get from any market-data call, not a
 * value with its own lifecycle worth migrating a column for.
 */
async function recordDataPlanStatus(connectionId: string, ok: boolean): Promise<void> {
  try {
    const connection = await BrokerConnection.findByPk(connectionId);
    if (!connection) return;
    await connection.update({
      meta: { ...(connection.meta ?? {}), dataPlanOk: ok, dataPlanCheckedAt: new Date().toISOString() },
    });
  } catch {
    // Best-effort only — never let a bookkeeping failure break the actual
    // market-data call this was piggybacking on.
  }
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
  try {
    const candles = await adapter.getHistoricalData(params);
    void recordDataPlanStatus(connection.id, true);
    return candles;
  } catch (err) {
    if (err instanceof ApiError && err.errorCode === 'DATA_PLAN_REQUIRED') {
      void recordDataPlanStatus(connection.id, false);
      throw ApiError.forbidden(err.message);
    }
    if (err instanceof ApiError && err.errorCode === 'SESSION_EXPIRED') {
      await markSessionExpired(connection);
      throw ApiError.badRequest(`Your ${broker} session has expired — please reconnect your account.`);
    }
    throw err;
  }
}

/**
 * Live LTP/OHLC for one instrument — used by the chart header and anywhere
 * else that needs a one-off quote outside a live feed session. Same
 * plan-required bookkeeping as `getHistoricalCandles`.
 */
export async function getQuote(userId: string, broker: BrokerName, tradingSymbol: string, exchange?: string) {
  const connection = await getActiveConnection(userId, broker);
  const adapter = buildBrokerAdapter(connection);
  try {
    const quote = await adapter.getQuote(tradingSymbol, exchange);
    void recordDataPlanStatus(connection.id, true);
    return quote;
  } catch (err) {
    if (err instanceof ApiError && err.errorCode === 'DATA_PLAN_REQUIRED') {
      void recordDataPlanStatus(connection.id, false);
      throw ApiError.forbidden(err.message);
    }
    if (err instanceof ApiError && err.errorCode === 'SESSION_EXPIRED') {
      await markSessionExpired(connection);
      throw ApiError.badRequest(`Your ${broker} session has expired — please reconnect your account.`);
    }
    throw err;
  }
}

/**
 * Expiry dates currently listed for one index underlying — populates the
 * options-chain page's expiry picker. Same plan-required/session-expired
 * handling as every other live market-data call above.
 */
export async function getOptionChainExpiries(userId: string, broker: BrokerName, underlying: IndexUnderlying) {
  const connection = await getActiveConnection(userId, broker);
  const adapter = buildBrokerAdapter(connection);
  try {
    const expiries = await adapter.getOptionChainExpiries(underlying);
    void recordDataPlanStatus(connection.id, true);
    return expiries;
  } catch (err) {
    if (err instanceof ApiError && err.errorCode === 'DATA_PLAN_REQUIRED') {
      void recordDataPlanStatus(connection.id, false);
      throw ApiError.forbidden(err.message);
    }
    if (err instanceof ApiError && err.errorCode === 'SESSION_EXPIRED') {
      await markSessionExpired(connection);
      throw ApiError.badRequest(`Your ${broker} session has expired — please reconnect your account.`);
    }
    throw err;
  }
}

/**
 * The full live option chain (every strike, CE+PE) for one index
 * underlying/expiry — the data source for the options-chain page. Never
 * cached in Postgres (unlike holdings/positions/orders): this is
 * deliberately always a live broker call since the whole point of the page
 * is real-time OI/bid-ask, and it's polled on an interval from the client
 * rather than kept warm server-side.
 */
export async function getOptionChain(userId: string, broker: BrokerName, underlying: IndexUnderlying, expiry?: string) {
  const connection = await getActiveConnection(userId, broker);
  const adapter = buildBrokerAdapter(connection);
  try {
    const chain = await adapter.getOptionChain(underlying, expiry);
    void recordDataPlanStatus(connection.id, true);
    return chain;
  } catch (err) {
    if (err instanceof ApiError && err.errorCode === 'DATA_PLAN_REQUIRED') {
      void recordDataPlanStatus(connection.id, false);
      throw ApiError.forbidden(err.message);
    }
    if (err instanceof ApiError && err.errorCode === 'SESSION_EXPIRED') {
      await markSessionExpired(connection);
      throw ApiError.badRequest(`Your ${broker} session has expired — please reconnect your account.`);
    }
    throw err;
  }
}