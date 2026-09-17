import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { listHoldingsHandler } from './holding.controller';

const router = Router();
router.use(requireAuth);

const listHoldingsQuerySchema = Joi.object({
  broker: Joi.string().valid('dhan', 'zerodha', 'groww').required(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

/**
 * @openapi
 * components:
 *   schemas:
 *     HoldingRecord:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         broker: { type: string }
 *         exchange: { type: string }
 *         tradingSymbol: { type: string }
 *         isin: { type: string, nullable: true }
 *         quantity: { type: number }
 *         averagePrice: { type: number }
 *         lastTradedPrice: { type: number, nullable: true, description: 'Last known price from the periodic broker sync — for a live price, subscribe via /ws/market-data instead.' }
 */

/**
 * @openapi
 * /holdings:
 *   get:
 *     tags: [Holdings]
 *     summary: Get the user's long-term equity holdings synced from their connected broker (paginated)
 *     description: Static, periodically-synced data. For a live-updating price/P&L, the frontend additionally subscribes to each holding's instrument over /ws/market-data.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: broker
 *         required: true
 *         schema: { type: string, enum: [dhan, zerodha, groww] }
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
 *         description: Paginated list of holdings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/HoldingRecord' }
 *                 meta: { $ref: '#/components/schemas/PaginationMeta' }
 */
router.get('/', validate(listHoldingsQuerySchema, 'query'), listHoldingsHandler);

export default router;