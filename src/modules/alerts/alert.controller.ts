import { Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { parsePagination } from '../../utils/pagination';
import * as alertService from './alert.service';

export const listAlertsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const pagination = parsePagination(req.query);
  const onlyUnacknowledged = req.query.unacknowledged === 'true';
  const { rows, meta, unacknowledgedCount } = await alertService.listAlerts(req.user!.id, pagination, onlyUnacknowledged);
  res.json({ success: true, data: rows, meta: { ...meta, unacknowledgedCount } });
});

export const acknowledgeAlertHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const alert = await alertService.acknowledgeAlert(req.user!.id, req.params.id);
  res.json({ success: true, data: alert });
});
