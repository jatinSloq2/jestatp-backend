import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { listAlertsHandler, acknowledgeAlertHandler } from './alert.controller';

const router = Router();
router.use(requireAuth);

const idParamSchema = Joi.object({ id: Joi.string().uuid().required() });
const listQuerySchema = Joi.object({
  unacknowledged: Joi.string().valid('true', 'false').optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

/**
 * @openapi
 * /alerts:
 *   get:
 *     tags: [Alerts]
 *     summary: List alerts raised by the trading engine (rejected orders, stuck positions, etc)
 *     description: >
 *       Surfaces events raised via alerting.service.ts — mainly from liveEngine.ts when a live
 *       order is rejected or a position can't be confirmed closed. `meta.unacknowledgedCount`
 *       is always the TOTAL unacknowledged count regardless of filters/pagination, for a
 *       notification-bell badge.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: unacknowledged
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *     responses:
 *       200: { description: Alerts, newest first }
 */
router.get('/', validate(listQuerySchema, 'query'), listAlertsHandler);

/**
 * @openapi
 * /alerts/{id}/acknowledge:
 *   post:
 *     tags: [Alerts]
 *     summary: Mark an alert as acknowledged
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Acknowledged }
 *       404: { description: Not found }
 */
router.post('/:id/acknowledge', validate(idParamSchema, 'params'), acknowledgeAlertHandler);

export default router;
