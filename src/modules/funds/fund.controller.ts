import { Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import * as fundService from './fund.service';
import { BrokerName } from '../../models/brokerConnection.model';

export const getFundsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const broker = req.query.broker as BrokerName;
  const funds = await fundService.getFunds(req.user!.id, broker);
  res.json({ success: true, data: funds });
});
