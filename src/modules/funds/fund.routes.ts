import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { getFundsHandler } from './fund.controller';

const router = Router();
router.use(requireAuth);

const getFundsQuerySchema = Joi.object({
  broker: Joi.string().valid('dhan', 'zerodha', 'groww').required(),
});

/**
 * @openapi
 * components:
 *   schemas:
 *     FundRecord:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         broker: { type: string }
 *         availableBalance: { type: number, description: Cash available to trade with }
 *         usedMargin: { type: number, description: Margin currently blocked/utilized }
 *         totalBalance: { type: number }
 *         collateral: { type: number }
 *         syncedAt: { type: string, format: date-time }
 */

/**
 * @openapi
 * /funds:
 *   get:
 *     tags: [Funds]
 *     summary: Get the user's available balance / margin, synced live from their broker
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: broker
 *         required: true
 *         schema: { type: string, enum: [dhan, zerodha, groww] }
 *     responses:
 *       200:
 *         description: Fund/balance snapshot
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/FundRecord' }
 */
router.get('/', validate(getFundsQuerySchema, 'query'), getFundsHandler);

export default router;
