import { BrokerConnection } from '../../../models';
import { decrypt } from '../../../utils/crypto';
import { ApiError } from '../../../utils/ApiError';
import { BrokerAdapter } from './brokerAdapter.interface';
import { DhanAdapter } from './dhan.adapter';
import { ZerodhaAdapter } from './zerodha.adapter';
import { GrowwAdapter } from './groww.adapter';

/**
 * The only place in the codebase that knows how to turn a stored,
 * encrypted BrokerConnection row into a live, ready-to-use BrokerAdapter.
 * Everything above this (services/controllers/strategy engine later) only
 * ever talks to the generic `BrokerAdapter` interface.
 */
export function buildBrokerAdapter(connection: BrokerConnection): BrokerAdapter {
  const accessToken = connection.accessTokenEncrypted ? decrypt(connection.accessTokenEncrypted) : undefined;
  const apiKey = connection.apiKeyEncrypted ? decrypt(connection.apiKeyEncrypted) : undefined;
  const apiSecret = connection.apiSecretEncrypted ? decrypt(connection.apiSecretEncrypted) : undefined;

  switch (connection.broker) {
    case 'dhan':
      if (!accessToken || !connection.clientId) {
        throw ApiError.badRequest('Dhan connection is missing accessToken/clientId');
      }
      return new DhanAdapter(accessToken, connection.clientId);

    case 'zerodha':
      if (!apiKey || !apiSecret) {
        throw ApiError.badRequest('Zerodha connection is missing apiKey/apiSecret');
      }
      return new ZerodhaAdapter(apiKey, apiSecret, accessToken);

    case 'groww':
      if (!apiKey || !accessToken) {
        throw ApiError.badRequest('Groww connection is missing apiKey/accessToken');
      }
      return new GrowwAdapter(apiKey, accessToken);

    default:
      throw ApiError.badRequest(`Unsupported broker: ${connection.broker}`);
  }
}

/** Builds an unauthenticated adapter shell purely to run the connect() exchange. */
export function buildAdapterForConnect(
  broker: 'dhan' | 'zerodha' | 'groww',
  seed: { apiKey?: string; apiSecret?: string; clientId?: string },
): BrokerAdapter {
  switch (broker) {
    case 'dhan':
      return new DhanAdapter('', seed.clientId || '');
    case 'zerodha':
      return new ZerodhaAdapter(seed.apiKey || '', seed.apiSecret || '');
    case 'groww':
      return new GrowwAdapter(seed.apiKey || '');
    default:
      throw ApiError.badRequest(`Unsupported broker: ${broker}`);
  }
}
