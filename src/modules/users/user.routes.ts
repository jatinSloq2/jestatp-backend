import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { getProfileHandler, updateProfileHandler } from './user.controller';

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /users/me:
 *   get:
 *     tags: [Users]
 *     summary: Get my profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Current user profile }
 */
router.get('/me', getProfileHandler);

/**
 * @openapi
 * /users/me:
 *   patch:
 *     tags: [Users]
 *     summary: Update my profile
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName: { type: string }
 *     responses:
 *       200: { description: Updated profile }
 */
router.patch('/me', validate(Joi.object({ fullName: Joi.string().min(2).max(120) })), updateProfileHandler);

export default router;
