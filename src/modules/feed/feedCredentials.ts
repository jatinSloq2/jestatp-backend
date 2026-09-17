import { BrokerConnection } from '../../models';
import { ApiError } from '../../utils/ApiError';
import { decrypt } from '../../utils/crypto';

/**
 * Shapes match `GrowwCredentials` / `ZerodhaCredentials` / `DhanCredentials`
 * in jestatp-feed-service/app/schemas.py exactly (camelCase field names,
 * since those models declare `populate_by_name=True` and accept either —
 * we always send the alias form here to keep the wire payload human-readable).
 *
 * These plaintext credentials only ever exist in-process, in the request
 * body sent to the feed service over the internal docker network — never
 * logged, never persisted anywhere beyond the existing encrypted columns.
 */
export function buildFeedCredentials(connection: BrokerConnection): Record<string, string> {
  const accessToken = connection.accessTokenEncrypted ? decrypt(connection.accessTokenEncrypted) : undefined;
  const apiKey = connection.apiKeyEncrypted ? decrypt(connection.apiKeyEncrypted) : undefined;

  switch (connection.broker) {
    case 'groww':
      if (!accessToken) throw ApiError.badRequest('Groww connection is missing an access token');
      return { accessToken };

    case 'zerodha':
      if (!apiKey || !accessToken) throw ApiError.badRequest('Zerodha connection is missing apiKey/accessToken');
      return { apiKey, accessToken };

    case 'dhan':
      if (!accessToken || !connection.clientId) {
        throw ApiError.badRequest('Dhan connection is missing accessToken/clientId');
      }
      return { clientId: connection.clientId, accessToken };

    default:
      throw ApiError.badRequest(`Unsupported broker for live feed: ${connection.broker}`);
  }
}
