import { Alert } from '../../models';
import { ApiError } from '../../utils/ApiError';
import { PaginationParams, buildPaginationMeta } from '../../utils/pagination';

export async function listAlerts(userId: string, pagination: PaginationParams, onlyUnacknowledged: boolean) {
  const where: Record<string, unknown> = { userId };
  if (onlyUnacknowledged) where.acknowledgedAt = null;

  const { count, rows } = await Alert.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: pagination.limit,
    offset: pagination.offset,
  });

  const unacknowledgedCount = await Alert.count({ where: { userId, acknowledgedAt: null } });

  return { rows, meta: buildPaginationMeta(count, pagination.page, pagination.limit), unacknowledgedCount };
}

export async function acknowledgeAlert(userId: string, alertId: string): Promise<Alert> {
  const alert = await Alert.findOne({ where: { id: alertId, userId } });
  if (!alert) throw ApiError.notFound('Alert not found');
  if (!alert.acknowledgedAt) await alert.update({ acknowledgedAt: new Date() });
  return alert;
}
