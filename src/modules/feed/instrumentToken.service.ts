import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { BrokerName } from '../../models/brokerConnection.model';
import {
  resolveDhanSecurityId,
  resolveGrowwExchangeToken,
  resolveZerodhaInstrumentToken,
} from '../brokers/adapters/instrumentResolver';
import { FeedSegment } from './feed.types';

const DHAN_SCRIP_MASTER_URL = 'https://images.dhan.co/api-data/api-scrip-master.csv';
const GROWW_INSTRUMENT_CSV_URL = 'https://growwapi-assets.groww.in/instruments/instrument.csv';

async function fetchCsvText(url: string, headers?: Record<string, string>): Promise<string> {
  const response = await fetch(url, { headers: { Accept: 'text/csv, text/plain, */*', ...headers } });
  if (!response.ok) {
    throw new ApiError(response.status >= 500 ? 502 : 400, `Failed to fetch instrument master ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

/** Credentials needed purely to *download* an instrument master — a subset of the full broker credential set. */
export interface FeedTokenCredentials {
  zerodha?: { apiKey: string; accessToken: string };
}

/**
 * Resolves the id the *feed* (websocket) API needs for one instrument —
 * distinct from whatever id the broker's REST API uses for order placement.
 * Groww and Dhan's instrument masters are public CDN dumps; Zerodha's
 * per-exchange dump technically requires the same auth headers as every
 * other Kite Connect call in practice, so its credentials are threaded
 * through here.
 */
export async function resolveFeedToken(
  broker: BrokerName,
  exchange: string,
  tradingSymbol: string,
  segment: FeedSegment | undefined,
  creds: FeedTokenCredentials,
): Promise<string> {
  switch (broker) {
    case 'zerodha': {
      if (!creds.zerodha) {
        throw ApiError.badRequest('Missing Zerodha credentials needed to resolve the instrument token');
      }
      const { apiKey, accessToken } = creds.zerodha;
      const token = await resolveZerodhaInstrumentToken(exchange, tradingSymbol, (ex) =>
        fetchCsvText(`${env.brokers.zerodha.baseUrl}/instruments/${ex}`, {
          Authorization: `token ${apiKey}:${accessToken}`,
          'X-Kite-Version': '3',
        }),
      );
      return String(token);
    }

    case 'dhan': {
      const instrument = await resolveDhanSecurityId(exchange, tradingSymbol, segment, () => fetchCsvText(DHAN_SCRIP_MASTER_URL));
      return instrument.securityId;
    }

    case 'groww': {
      const instrument = await resolveGrowwExchangeToken(exchange, tradingSymbol, segment, () =>
        fetchCsvText(GROWW_INSTRUMENT_CSV_URL),
      );
      return instrument.exchangeToken;
    }

    default:
      throw ApiError.badRequest(`Unsupported broker for feed token resolution: ${broker}`);
  }
}
