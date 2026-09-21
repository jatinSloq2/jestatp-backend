import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { validate } from '../../../middlewares/validate.middleware';
import {
  createCustomIndicatorHandler,
  deleteCustomIndicatorHandler,
  getCustomIndicatorHandler,
  listCustomIndicatorsHandler,
  testCustomIndicatorHandler,
  updateCustomIndicatorHandler,
} from './customIndicators.controller';
import {
  createCustomIndicatorSchema,
  customIndicatorIdParamSchema,
  testCustomIndicatorSchema,
  updateCustomIndicatorSchema,
} from './customIndicators.validator';

const router = Router();
router.use(requireAuth);

const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

/**
 * @openapi
 * /custom-indicators:
 *   get:
 *     tags: [CustomIndicators]
 *     summary: List the caller's saved custom indicators
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paginated list }
 *   post:
 *     tags: [CustomIndicators]
 *     summary: Create a custom indicator (validated against synthetic sample data before saving)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 *       400: { description: Indicator code failed validation, or the name is already taken }
 */
router.get('/', validate(listQuerySchema, 'query'), listCustomIndicatorsHandler);
router.post('/', validate(createCustomIndicatorSchema), createCustomIndicatorHandler);

/**
 * @openapi
 * /custom-indicators/test:
 *   post:
 *     tags: [CustomIndicators]
 *     summary: Run not-yet-saved indicator code and return its computed series
 *     description: >
 *       The Custom Indicator Studio's Validate/Run Test action. Pass broker + instrument +
 *       exchange + timeframe to test against real historical candles; omit them to test
 *       against a small synthetic sample series.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Computed series plus current/previous value }
 *       400: { description: Indicator code failed to run }
 */
router.post('/test', validate(testCustomIndicatorSchema), testCustomIndicatorHandler);

router.get('/:id', validate(customIndicatorIdParamSchema, 'params'), getCustomIndicatorHandler);
router.put('/:id', validate(customIndicatorIdParamSchema, 'params'), validate(updateCustomIndicatorSchema), updateCustomIndicatorHandler);
router.delete('/:id', validate(customIndicatorIdParamSchema, 'params'), deleteCustomIndicatorHandler);

export default router;
