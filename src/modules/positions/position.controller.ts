import { Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import * as positionService from './position.service';
import { BrokerName } from '../../models/brokerConnection.model';
import { PositionSegment } from '../../models/position.model';
import { parsePagination } from '../../utils/pagination';

export const listPositionsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const broker = req.query.broker as BrokerName;
  const segment = req.query.segment as PositionSegment | undefined;
  const pagination = parsePagination(req.query);

  const { rows, meta, lastSyncedAt } = await positionService.getPositions(req.user!.id, broker, pagination, segment);
  res.json({ success: true, data: rows, meta: { ...meta, lastSyncedAt } });
});
