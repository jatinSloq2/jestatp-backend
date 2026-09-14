import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { disable2faSchema, emailTwoFaEnableSchema, totpEnableSchema } from './auth.validation';
import {
  disableTwoFaHandler,
  emailTwoFaEnableHandler,
  emailTwoFaSetupHandler,
  totpEnableHandler,
  totpSetupHandler,
  twoFactorStatusHandler,
} from './twoFactor.controller';

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /auth/2fa/status:
 *   get:
 *     tags: [Two-Factor Auth]
 *     summary: Get my current 2FA status
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: 2FA status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     enabled: { type: boolean }
 *                     method: { type: string, enum: [email, totp], nullable: true }
 */
router.get('/status', twoFactorStatusHandler);

/**
 * @openapi
 * /auth/2fa/totp/setup:
 *   post:
 *     tags: [Two-Factor Auth]
 *     summary: Start Google-Authenticator-style 2FA setup (user opts in manually from settings)
 *     description: >
 *       Generates a new TOTP secret and returns it as both a raw secret and a QR code the
 *       user scans with Google Authenticator / Authy / any TOTP app. 2FA is NOT enabled yet —
 *       call /auth/2fa/totp/enable with a code from the app to confirm.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: TOTP secret + QR code to scan
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     secret: { type: string, description: "Manual-entry fallback if the user can't scan a QR" }
 *                     keyUri: { type: string, description: "otpauth:// URI encoded in the QR code" }
 *                     qrCodeDataUrl: { type: string, description: "data:image/png;base64,... — render directly in an <img> tag" }
 */
router.post('/totp/setup', totpSetupHandler);

/**
 * @openapi
 * /auth/2fa/totp/enable:
 *   post:
 *     tags: [Two-Factor Auth]
 *     summary: Confirm TOTP setup with a code from the authenticator app — enables 2FA
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string, example: "123456" }
 *     responses:
 *       200: { description: 2FA enabled with method=totp }
 *       400: { description: Invalid code }
 */
router.post('/totp/enable', validate(totpEnableSchema), totpEnableHandler);

/**
 * @openapi
 * /auth/2fa/email/setup:
 *   post:
 *     tags: [Two-Factor Auth]
 *     summary: Start email-OTP 2FA setup — sends a confirmation code to the user's own email
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Confirmation code sent }
 */
router.post('/email/setup', emailTwoFaSetupHandler);

/**
 * @openapi
 * /auth/2fa/email/enable:
 *   post:
 *     tags: [Two-Factor Auth]
 *     summary: Confirm email-OTP 2FA setup with the code just emailed — enables 2FA
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string, example: "123456" }
 *     responses:
 *       200: { description: 2FA enabled with method=email }
 *       400: { description: Invalid or expired code }
 */
router.post('/email/enable', validate(emailTwoFaEnableSchema), emailTwoFaEnableHandler);

/**
 * @openapi
 * /auth/2fa/disable:
 *   post:
 *     tags: [Two-Factor Auth]
 *     summary: Disable 2FA
 *     description: For local (email/password) accounts, the current password is required to confirm.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               password: { type: string, description: Required for local accounts }
 *     responses:
 *       200: { description: 2FA disabled }
 *       401: { description: Incorrect password }
 */
router.post('/disable', validate(disable2faSchema), disableTwoFaHandler);

export default router;
