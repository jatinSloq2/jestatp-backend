import { Router } from 'express';
import passport from '../../config/passport';
import { validate } from '../../middlewares/validate.middleware';
import { requireAuth } from '../../middlewares/auth.middleware';
import { authLimiter } from '../../middlewares/rateLimiters';
import {
  loginSchema,
  login2faVerifySchema,
  refreshSchema,
  registerSchema,
  resendEmailVerificationSchema,
  verifyEmailSchema,
} from './auth.validation';
import {
  googleCallbackHandler,
  googleFailureHandler,
  listSessionsHandler,
  loginHandler,
  logoutAllHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
  registerHandler,
  resendEmailVerificationHandler,
  resendLogin2faHandler,
  verifyEmailHandler,
  verifyLogin2faHandler,
} from './auth.controller';
import twoFactorRoutes from './twoFactor.routes';

const router = Router();
router.use(authLimiter);

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     cookieAuth:
 *       type: apiKey
 *       in: cookie
 *       name: accessToken
 *   schemas:
 *     RegisterInput:
 *       type: object
 *       required: [fullName, email, password]
 *       properties:
 *         fullName: { type: string, example: "Rahul Sharma" }
 *         email: { type: string, format: email, example: "rahul@example.com" }
 *         password: { type: string, format: password, example: "Str0ngPass!23" }
 *     LoginInput:
 *       type: object
 *       required: [email, password]
 *       properties:
 *         email: { type: string, format: email }
 *         password: { type: string, format: password }
 *     User:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         fullName: { type: string }
 *         email: { type: string }
 *         authProvider: { type: string, enum: [local, google] }
 *         role: { type: string, enum: [user, admin] }
 *         isEmailVerified: { type: boolean }
 *         isActive: { type: boolean }
 *         twoFactorEnabled: { type: boolean }
 *         twoFactorMethod: { type: string, enum: [email, totp], nullable: true }
 *     LoginResponse:
 *       type: object
 *       description: >
 *         `status` tells the frontend what to do next. On "verified", httpOnly
 *         accessToken/refreshToken/csrfToken cookies are set and `user` is returned.
 *         On "requires_email_verification", call /auth/verify-email. On "requires_2fa",
 *         a short-lived `twofaToken` cookie was set — call /auth/login/2fa/verify next.
 *       properties:
 *         status: { type: string, enum: [verified, requires_email_verification, requires_2fa] }
 *         user: { $ref: '#/components/schemas/User' }
 *         email: { type: string, description: Present when status=requires_email_verification }
 *         method: { type: string, enum: [email, totp], description: Present when status=requires_2fa }
 */

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user with email + password
 *     description: >
 *       Creates the account and emails a 6-digit verification code. No session is started —
 *       the account cannot log in until the email is verified via /auth/verify-email.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RegisterInput' }
 *     responses:
 *       201: { description: Account created, verification code emailed }
 *       409: { description: Email already registered }
 */
router.post('/register', validate(registerSchema), registerHandler);

/**
 * @openapi
 * /auth/verify-email:
 *   post:
 *     tags: [Auth]
 *     summary: Verify a signup email with the 6-digit code that was emailed
 *     description: On success, logs the user in immediately (sets session cookies).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email: { type: string, format: email }
 *               code: { type: string, example: "482913" }
 *     responses:
 *       200: { description: Email verified, session cookies set }
 *       400: { description: Invalid or expired code }
 */
router.post('/verify-email', validate(verifyEmailSchema), verifyEmailHandler);

/**
 * @openapi
 * /auth/resend-verification:
 *   post:
 *     tags: [Auth]
 *     summary: Resend the signup email verification code
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: A new code was sent (if an unverified account exists) }
 */
router.post('/resend-verification', validate(resendEmailVerificationSchema), resendEmailVerificationHandler);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login with email + password
 *     description: >
 *       Unverified emails are rejected (403, a fresh OTP is emailed automatically).
 *       Accounts with 2FA enabled get a `requires_2fa` response instead of a session —
 *       finish with /auth/login/2fa/verify.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/LoginInput' }
 *     responses:
 *       200:
 *         description: Login result — see LoginResponse.status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/LoginResponse' }
 *       401: { description: Invalid credentials }
 *       403: { description: Email not verified }
 */
router.post('/login', validate(loginSchema), loginHandler);

/**
 * @openapi
 * /auth/login/2fa/verify:
 *   post:
 *     tags: [Auth]
 *     summary: Complete login by submitting the 2FA code (email OTP or Google Authenticator)
 *     description: Requires the short-lived `twofaToken` cookie set by /auth/login. On success, sets full session cookies.
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
 *       200: { description: Login complete, session cookies set }
 *       401: { description: Invalid code or expired 2FA session }
 */
router.post('/login/2fa/verify', validate(login2faVerifySchema), verifyLogin2faHandler);

/**
 * @openapi
 * /auth/login/2fa/resend:
 *   post:
 *     tags: [Auth]
 *     summary: Resend the login 2FA email OTP (email method only; not applicable for authenticator app)
 *     responses:
 *       200: { description: A new code was sent }
 */
router.post('/login/2fa/resend', resendLogin2faHandler);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Rotate the session using the httpOnly refresh token cookie
 *     responses:
 *       200: { description: New session cookies issued }
 *       401: { description: Invalid or expired refresh token }
 */
router.post('/refresh', validate(refreshSchema), refreshHandler);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout — revokes the current refresh token and clears session cookies
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { description: Logged out }
 */
router.post('/logout', logoutHandler);

/**
 * @openapi
 * /auth/logout-all:
 *   post:
 *     tags: [Auth]
 *     summary: Logout everywhere — revokes every active session/device for this account
 *     security: [{ cookieAuth: [] }, { bearerAuth: [] }]
 *     responses:
 *       200: { description: All sessions revoked }
 */
router.post('/logout-all', requireAuth, logoutAllHandler);

/**
 * @openapi
 * /auth/sessions:
 *   get:
 *     tags: [Auth]
 *     summary: List my active sessions (devices currently logged in)
 *     security: [{ cookieAuth: [] }, { bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Active sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       userAgent: { type: string, nullable: true }
 *                       ipAddress: { type: string, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *                       expiresAt: { type: string, format: date-time }
 */
router.get('/sessions', requireAuth, listSessionsHandler);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get the currently authenticated user's profile
 *     security: [{ cookieAuth: [] }, { bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/User' }
 *       401: { description: Not authenticated }
 */
router.get('/me', requireAuth, meHandler);

/**
 * @openapi
 * /auth/google:
 *   get:
 *     tags: [Auth]
 *     summary: Start Google OAuth login (redirects to Google's consent screen)
 *     responses:
 *       302: { description: Redirect to Google }
 */
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

/**
 * @openapi
 * /auth/google/callback:
 *   get:
 *     tags: [Auth]
 *     summary: Google OAuth callback
 *     description: >
 *       Google-authenticated accounts are treated as email-verified automatically.
 *       If the account has 2FA enabled, redirects to the frontend with
 *       `?requires2fa=true&method=...` and sets the `twofaToken` cookie (finish via
 *       /auth/login/2fa/verify); otherwise sets full session cookies and redirects to success.
 *     responses:
 *       302: { description: Redirect to the configured frontend URL }
 */
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/api/v1/auth/google/failure' }),
  googleCallbackHandler,
);

router.get('/google/failure', googleFailureHandler);

router.use('/2fa', twoFactorRoutes);

export default router;
