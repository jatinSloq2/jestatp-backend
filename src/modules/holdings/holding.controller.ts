import { Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import * as holdingService from './holding.service';
import { BrokerName } from '../../models/brokerConnection.model';
import { parsePagination } from '../../utils/pagination';

export const listHoldingsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const broker = req.query.broker as BrokerName;
  const pagination = parsePagination(req.query);

  const { rows, meta, lastSyncedAt } = await holdingService.getHoldings(req.user!.id, broker, pagination);
  res.json({ success: true, data: rows, meta: { ...meta, lastSyncedAt } });
});