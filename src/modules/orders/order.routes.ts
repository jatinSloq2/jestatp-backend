import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { listOrdersHandler, placeOrderHandler } from './order.controller';

const router = Router();
router.use(requireAuth);

const listOrdersQuerySchema = Joi.object({
  broker: Joi.string().valid('dhan', 'zerodha', 'groww').required(),
  segment: Joi.string().valid('equity', 'fno', 'currency', 'commodity').optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

const placeOrderSchema = Joi.object({
  broker: Joi.string().valid('dhan', 'zerodha', 'groww').required(),
  segment: Joi.string().valid('equity', 'fno', 'currency', 'commodity').required(),
  tradingSymbol: Joi.string().min(1).max(60).required(),
  exchange: Joi.string().min(1).max(10).uppercase().required(),
  side: Joi.string().valid('BUY', 'SELL').required(),
  orderType: Joi.string().valid('MARKET', 'LIMIT', 'SL', 'SL-M').required(),
  productType: Joi.string().valid('CNC', 'MIS', 'NRML').required(),
  quantity: Joi.number().integer().min(1).required(),
  price: Joi.number().positive().when('orderType', { is: Joi.valid('LIMIT', 'SL'), then: Joi.required(), otherwise: Joi.optional() }),
  triggerPrice: Joi.number()
    .positive()
    .when('orderType', { is: Joi.valid('SL', 'SL-M'), then: Joi.required(), otherwise: Joi.optional() }),
});

/**
 * @openapi
 * components:
 *   schemas:
 *     PaginationMeta:
 *       type: object
 *       properties:
 *         page: { type: integer }
 *         limit: { type: integer }
 *         total: { type: integer }
 *         totalPages: { type: integer }
 *         hasNextPage: { type: boolean }
 *         hasPrevPage: { type: boolean }
 *         lastSyncedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: >
 *             When this broker connection's data was last refreshed from the broker's API.
 *             If older than SYNC_STALE_THRESHOLD_SECONDS, a background refresh was just queued —
 *             call again shortly to see it land, or POST /brokers/{broker}/sync to force it now.
 *     OrderRecord:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         broker: { type: string }
 *         brokerOrderId: { type: string }
 *         exchange: { type: string }
 *         segment: { type: string, enum: [equity, fno, currency, commodity] }
 *         tradingSymbol: { type: string }
 *         side: { type: string, enum: [BUY, SELL] }
 *         orderType: { type: string, enum: [MARKET, LIMIT, SL, SL-M] }
 *         productType: { type: string, enum: [CNC, MIS, NRML] }
 *         quantity: { type: integer }
 *         filledQuantity: { type: integer }
 *         price: { type: number, nullable: true }
 *         averagePrice: { type: number, nullable: true }
 *         status:
 *           type: string
 *           enum: [CREATED, VALIDATED, SUBMITTED, OPEN, PARTIALLY_FILLED, FILLED, CANCEL_REQUESTED, CANCELLED, REJECTED]
 *         placedAt: { type: string, format: date-time, nullable: true }
 */

/**
 * @openapi
 * /orders:
 *   get:
 *     tags: [Orders]
 *     summary: Get the user's orders synced live from their connected broker (paginated)
 *     description: >
 *       Pulls the latest order book from the broker's API inside a DB transaction, upserts
 *       it into our Order Management System (OMS) table, and returns a paginated slice.
 *       Filter by `segment` to separate equity delivery/intraday orders from F&O orders.
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
 *         description: Omit to get all segments
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
 *         description: Paginated list of orders
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/OrderRecord' }
 *                 meta: { $ref: '#/components/schemas/PaginationMeta' }
 *       400: { description: No active broker connection }
 */
router.get('/', validate(listOrdersQuerySchema, 'query'), listOrdersHandler);

/**
 * @openapi
 * /orders:
 *   post:
 *     tags: [Orders]
 *     summary: Place a real order with the broker
 *     description: >
 *       Places a one-off manual order — the same underlying path liveEngine.ts uses for
 *       automated strategy orders (orderPlacement.service.ts), so it gets identical
 *       tracking and reconciliation. Creates an Order row before the broker call goes out;
 *       if the broker rejects it, that row is still visible via GET /orders (status REJECTED)
 *       even though this endpoint itself returns 400.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [broker, segment, tradingSymbol, exchange, side, orderType, productType, quantity]
 *             properties:
 *               broker: { type: string, enum: [dhan, zerodha, groww] }
 *               segment: { type: string, enum: [equity, fno, currency, commodity] }
 *               tradingSymbol: { type: string }
 *               exchange: { type: string }
 *               side: { type: string, enum: [BUY, SELL] }
 *               orderType: { type: string, enum: [MARKET, LIMIT, SL, SL-M] }
 *               productType: { type: string, enum: [CNC, MIS, NRML] }
 *               quantity: { type: integer, minimum: 1 }
 *               price: { type: number, description: Required for LIMIT/SL orders }
 *               triggerPrice: { type: number, description: Required for SL/SL-M orders }
 *     responses:
 *       201:
 *         description: Order accepted by the broker
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/OrderRecord' }
 *       400: { description: No active broker connection, or the broker rejected the order }
 */
router.post('/', validate(placeOrderSchema, 'body'), placeOrderHandler);

export default router;
