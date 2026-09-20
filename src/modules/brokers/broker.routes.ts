import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import {
  brokerParamSchema,
  connectDhanSchema,
  connectGrowwSchema,
  connectZerodhaCallbackSchema,
  connectZerodhaInitSchema,
  quoteQuerySchema,
} from './broker.validation';
import {
  connectDhanHandler,
  connectGrowwHandler,
  connectZerodhaHandler,
  disconnectBrokerHandler,
  getQuoteHandler,
  listMyConnectionsHandler,
  listSupportedBrokersHandler,
  syncBrokerHandler,
  zerodhaLoginUrlHandler,
} from './broker.controller';

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * components:
 *   schemas:
 *     BrokerConnection:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         broker: { type: string, enum: [dhan, zerodha, groww] }
 *         clientId: { type: string, nullable: true }
 *         status: { type: string, enum: [pending, connected, expired, revoked, error] }
 *         lastSyncedAt: { type: string, format: date-time, nullable: true }
 */

/**
 * @openapi
 * /brokers:
 *   get:
 *     tags: [Brokers]
 *     summary: List brokers supported by the platform (for the "Connect Broker" screen)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Supported brokers }
 */
router.get('/', listSupportedBrokersHandler);

/**
 * @openapi
 * /brokers/connections:
 *   get:
 *     tags: [Brokers]
 *     summary: List the current user's broker connections
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of connections
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/BrokerConnection' }
 */
router.get('/connections', listMyConnectionsHandler);

/**
 * @openapi
 * /brokers/dhan/connect:
 *   post:
 *     tags: [Brokers]
 *     summary: Connect a Dhan account using the access token generated on Dhan's own dashboard
 *     description: >
 *       We never collect the user's Dhan login password/PIN/OTP. The user generates a
 *       personal access token from DhanHQ's web console (Profile → Trading APIs) and pastes
 *       clientId + accessToken here. We validate it against Dhan's `/v2/profile` endpoint
 *       and store the token encrypted (AES-256-GCM) at rest.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientId, accessToken]
 *             properties:
 *               clientId: { type: string }
 *               accessToken: { type: string }
 *     responses:
 *       201: { description: Dhan connected }
 */
router.post('/dhan/connect', validate(connectDhanSchema), connectDhanHandler);

/**
 * @openapi
 * /brokers/zerodha/login-url:
 *   post:
 *     tags: [Brokers]
 *     summary: Get the official Zerodha Kite Connect login URL to redirect the user to
 *     description: >
 *       The frontend redirects the browser to the returned URL. The user logs in and
 *       completes 2FA directly on Zerodha's own domain — we never see their credentials.
 *       Zerodha then redirects back to our registered callback with a `request_token`.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [apiKey]
 *             properties:
 *               apiKey: { type: string }
 *     responses:
 *       200: { description: Login URL to redirect the user's browser to }
 */
router.post(
  '/zerodha/login-url',
  validate(connectZerodhaInitSchema.fork(['apiSecret'], (s) => s.optional())),
  zerodhaLoginUrlHandler,
);

/**
 * @openapi
 * /brokers/zerodha/connect:
 *   post:
 *     tags: [Brokers]
 *     summary: Complete the Zerodha connection by exchanging the request_token for an access_token
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [apiKey, apiSecret, requestToken]
 *             properties:
 *               apiKey: { type: string }
 *               apiSecret: { type: string }
 *               requestToken: { type: string, description: Returned by Zerodha's redirect after login }
 *     responses:
 *       201: { description: Zerodha connected }
 */
router.post(
  '/zerodha/connect',
  validate(connectZerodhaInitSchema.concat(connectZerodhaCallbackSchema)),
  connectZerodhaHandler,
);

/**
 * @openapi
 * /brokers/groww/connect:
 *   post:
 *     tags: [Brokers]
 *     summary: Connect a Groww account using API key + secret from Groww's trading-API console
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [apiKey, apiSecret]
 *             properties:
 *               apiKey: { type: string }
 *               apiSecret: { type: string }
 *     responses:
 *       201: { description: Groww connected }
 */
router.post('/groww/connect', validate(connectGrowwSchema), connectGrowwHandler);

/**
 * @openapi
 * /brokers/{broker}:
 *   delete:
 *     tags: [Brokers]
 *     summary: Disconnect a broker (revokes stored tokens)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: broker
 *         required: true
 *         schema: { type: string, enum: [dhan, zerodha, groww] }
 *     responses:
 *       200: { description: Broker disconnected }
 */
router.delete('/:broker', validate(brokerParamSchema, 'params'), disconnectBrokerHandler);

/**
 * @openapi
 * /brokers/{broker}/sync:
 *   post:
 *     tags: [Brokers]
 *     summary: Force an immediate background refresh of orders/positions/funds for this broker
 *     description: >
 *       GET /orders, /positions, and /funds always read from Postgres (fast) and only
 *       auto-refresh when the cached data is stale. Use this endpoint for a "sync now"
 *       button — it queues a high-priority job on the broker-sync worker and returns
 *       immediately (202); poll the GET endpoints' `meta.lastSyncedAt` a few seconds later
 *       to see the update land.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: broker
 *         required: true
 *         schema: { type: string, enum: [dhan, zerodha, groww] }
 *     responses:
 *       202: { description: Sync job queued }
 *       400: { description: No active connection for this broker }
 */
router.post('/:broker/sync', validate(brokerParamSchema, 'params'), syncBrokerHandler);

/**
 * @openapi
 * /brokers/{broker}/quote:
 *   get:
 *     tags: [Brokers]
 *     summary: One-off live LTP/OHLC for a single symbol
 *     description: >
 *       Used by the header's index ticker and anywhere else that needs a single quote
 *       outside a live feed session. Same data-plan-required / session-expired handling as
 *       backtests — a 403 means the broker plan doesn't cover live pricing (see the header's
 *       data-plan banner), a 400 with "session has expired" means reconnecting is needed.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: broker
 *         required: true
 *         schema: { type: string, enum: [dhan, zerodha, groww] }
 *       - in: query
 *         name: symbol
 *         required: true
 *         schema: { type: string }
 *         example: "NIFTY 50"
 *       - in: query
 *         name: exchange
 *         schema: { type: string }
 *         example: NSE
 *     responses:
 *       200: { description: Live quote }
 *       400: { description: No active connection, or session expired }
 *       403: { description: Broker account isn't subscribed to the data plan needed for live pricing }
 */
router.get('/:broker/quote', validate(brokerParamSchema, 'params'), validate(quoteQuerySchema, 'query'), getQuoteHandler);

export default router;
