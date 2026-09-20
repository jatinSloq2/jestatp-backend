import { Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import * as brokerService from './broker.service';
import { BrokerName } from '../../models/brokerConnection.model';
import { enqueueConnectionSync } from '../../queues/brokerSync.queue';

export const listSupportedBrokersHandler = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: brokerService.SUPPORTED_BROKERS });
});

export const listMyConnectionsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const connections = await brokerService.listConnections(req.user!.id);
  res.json({ success: true, data: connections });
});

export const connectDhanHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { clientId, accessToken } = req.body;
  const connection = await brokerService.connectDhan(req.user!.id, clientId, accessToken);
  res.status(201).json({ success: true, data: connection });
});

export const zerodhaLoginUrlHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { apiKey } = req.body;
  const url = await brokerService.getZerodhaLoginUrl(apiKey);
  res.json({ success: true, data: { loginUrl: url } });
});

export const connectZerodhaHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { apiKey, apiSecret, requestToken } = req.body;
  const connection = await brokerService.connectZerodha(req.user!.id, apiKey, apiSecret, requestToken);
  res.status(201).json({ success: true, data: connection });
});

export const connectGrowwHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { apiKey, apiSecret } = req.body;
  const connection = await brokerService.connectGroww(req.user!.id, apiKey, apiSecret);
  res.status(201).json({ success: true, data: connection });
});

export const disconnectBrokerHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const broker = req.params.broker as BrokerName;
  const connection = await brokerService.disconnectBroker(req.user!.id, broker);
  res.json({ success: true, data: connection });
});

export const syncBrokerHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const broker = req.params.broker as BrokerName;
  const connection = await brokerService.getActiveConnection(req.user!.id, broker);
  const job = await enqueueConnectionSync(connection.id);
  res.status(202).json({
    success: true,
    message: 'Sync queued — orders, positions, and funds will refresh in the background within a few seconds.',
    data: { jobId: job.id },
  });
});

/**
 * One-off LTP/OHLC lookup — e.g. the header's index ticker (NIFTY 50,
 * SENSEX, BANK NIFTY, USD/INR), or any other single-symbol "what's this
 * trading at right now" need outside a live feed subscription. Just a thin
 * wrapper over broker.service.ts's getQuote, which already owns the
 * data-plan-required / session-expired bookkeeping shared with
 * getHistoricalCandles.
 */
export const getQuoteHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const broker = req.params.broker as BrokerName;
  const { symbol, exchange } = req.query as { symbol: string; exchange?: string };
  const quote = await brokerService.getQuote(req.user!.id, broker, symbol, exchange);
  res.json({ success: true, data: quote });
});