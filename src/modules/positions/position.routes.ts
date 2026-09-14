import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { listPositionsHandler } from './position.controller';

const router = Router();
router.use(requireAuth);

const listPositionsQuerySchema = Joi.object({
  broker: Joi.string().valid('dhan', 'zerodha', 'groww').required(),
  segment: Joi.string().valid('equity', 'fno', 'currency', 'commodity').optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

/**
 * @openapi
 * components:
 *   schemas:
 *     PositionRecord:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         broker: { type: string }
 *         exchange: { type: string }
 *         segment: { type: string, enum: [equity, fno, currency, commodity] }
 *         tradingSymbol: { type: string }
 *         productType: { type: string }
 *         quantity: { type: integer }
 *         averagePrice: { type: number }
 *         lastTradedPrice: { type: number, nullable: true }
 *         realizedPnl: { type: number }
 *         unrealizedPnl: { type: number }
 */

/**
 * @openapi
 * /positions:
 *   get:
 *     tags: [Positions]
 *     summary: Get the user's current positions synced live from their connected broker (paginated)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: broker
 *         required: true
 *         schema: { type: string, enum: [dhan, zerodha, groww] }
 *       - in: query
 *         name: segment
 *         required: false
 *         schema: { type: string, enum: [equity, fno, currency, commodity] }
 *       - in: query
 *         name: page
 *         required: false
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *     responses:
 *       200:
 *         description: Paginated list of positions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/PositionRecord' }
 *                 meta: { $ref: '#/components/schemas/PaginationMeta' }
 */
router.get('/', validate(listPositionsQuerySchema, 'query'), listPositionsHandler);

export default router;
