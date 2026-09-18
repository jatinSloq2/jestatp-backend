import { BrokerName } from '../../models/brokerConnection.model';
import { resolveFeedToken as resolveFeedTokenViaBrokerService } from '../brokers/brokerService.client';
import { FeedSegment } from './feed.types';

/**
 * Resolves the broker-specific *feed* subscription id for one instrument —
 * Dhan's `securityId`, Zerodha's numeric `instrument_token`, Groww's
 * `exchange_token` — via jestatp-broker-service (official SDKs), which
 * caches each broker's instrument master internally. Node does no CSV
 * downloading or parsing itself.
 */
export function resolveFeedToken(
  broker: BrokerName,
  exchange: string,
  tradingSymbol: string,
  segment: FeedSegment,
  credentials: Record<string, string | undefined>,
): Promise<string> {
  return resolveFeedTokenViaBrokerService(broker, credentials, exchange, tradingSymbol, segment);
}