import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as authService from './auth.service';
import { env } from '../../config/env';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { User } from '../../models';
import {
  COOKIE_NAMES,
  clearSessionCookies,
  clearTwoFactorCookie,
  setSessionCookies,
  setTwoFactorCookie,
} from '../../utils/cookies';
import { ApiError } from '../../utils/ApiError';
import { signTwoFactorToken } from '../../utils/jwt';
import { RequestMeta } from './refreshToken.service';

function requestMeta(req: Request): RequestMeta {
  return {
    userAgent: req.headers['user-agent'] ?? null,
    ipAddress: req.ip ?? null,
  };
}

export const registerHandler = asyncHandler(async (req: Request, res: Response) => {
  const { fullName, email, password } = req.body;
  const result = await authService.register(fullName, email, password);
  res.status(201).json({ success: true, data: result });
});

export const verifyEmailHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email, code } = req.body;
  const { user, accessToken, refreshToken } = await authService.verifyEmail(email, code, requestMeta(req));
  setSessionCookies(res, { accessToken, refreshToken });
  res.status(200).json({ success: true, data: { user: user.toSafeJSON() } });
});

export const resendEmailVerificationHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;
  const result = await authService.resendEmailVerification(email);
  res.status(200).json({ success: true, data: result });
});

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password, requestMeta(req));

  switch (result.status) {
    case 'verified':
      setSessionCookies(res, { accessToken: result.accessToken, refreshToken: result.refreshToken });
      return res.status(200).json({ success: true, data: { status: 'verified', user: result.user.toSafeJSON() } });

    case 'requires_email_verification':
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in. A new code has been sent.',
        data: { status: 'requires_email_verification', email: result.email },
      });

    case 'requires_2fa':
      setTwoFactorCookie(res, result.twoFactorToken);
      return res.status(200).json({
        success: true,
        data: { status: 'requires_2fa', method: result.method },
      });
  }
});

export const verifyLogin2faHandler = asyncHandler(async (req: Request, res: Response) => {
  const twoFactorToken = req.cookies?.[COOKIE_NAMES.twoFactorToken];
  if (!twoFactorToken) {
    throw ApiError.unauthorized('No pending 2FA session. Please log in again.');
  }
  const { code } = req.body;
  const { user, accessToken, refreshToken } = await authService.verifyLogin2fa(twoFactorToken, code, requestMeta(req));

  clearTwoFactorCookie(res);
  setSessionCookies(res, { accessToken, refreshToken });
  res.status(200).json({ success: true, data: { user: user.toSafeJSON() } });
});

export const resendLogin2faHandler = asyncHandler(async (req: Request, res: Response) => {
  const twoFactorToken = req.cookies?.[COOKIE_NAMES.twoFactorToken];
  if (!twoFactorToken) {
    throw ApiError.unauthorized('No pending 2FA session. Please log in again.');
  }
  const result = await authService.resendLogin2faOtp(twoFactorToken);
  res.status(200).json({ success: true, data: result });
});

export const forgotPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;
  const result = await authService.forgotPassword(email);
  res.status(200).json({ success: true, data: result });
});

export const resetPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body;
  const result = await authService.resetPassword(token, password);
  res.status(200).json({ success: true, data: result });
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[COOKIE_NAMES.refreshToken] || req.body.refreshToken;
  if (!token) throw ApiError.unauthorized('No refresh token provided');

  const { user, accessToken, refreshToken } = await authService.refresh(token, requestMeta(req));
  setSessionCookies(res, { accessToken, refreshToken });
  res.status(200).json({ success: true, data: { user: user.toSafeJSON() } });
});

export const meHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = await User.findByPk(req.user!.id);
  res.status(200).json({ success: true, data: user?.toSafeJSON() });
});

export const logoutHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const token = req.cookies?.[COOKIE_NAMES.refreshToken] || req.body?.refreshToken;
  await authService.logout(token, req.user?.id);
  clearSessionCookies(res);
  res.status(200).json({ success: true, message: 'Logged out' });
});

export const logoutAllHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await authService.logoutAllDevices(req.user!.id);
  clearSessionCookies(res);
  res.status(200).json({ success: true, data: result });
});

export const listSessionsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const sessions = await authService.getMySessions(req.user!.id);
  res.status(200).json({ success: true, data: sessions });
});

/** Redirect handler after passport's Google strategy has authenticated the user (no tokens issued yet). */
export const googleCallbackHandler = asyncHandler(async (req: Request, res: Response) => {
  const googleUser = req.user as unknown as User;

  if (googleUser.twoFactorEnabled && googleUser.twoFactorMethod) {
    const twoFactorToken = signTwoFactorToken(googleUser.id);
    setTwoFactorCookie(res, twoFactorToken);

    const redirectUrl = new URL(env.google.successRedirect);
    redirectUrl.searchParams.set('requires2fa', 'true');
    redirectUrl.searchParams.set('method', googleUser.twoFactorMethod);
    return res.redirect(redirectUrl.toString());
  }

  const { accessToken, refreshToken } = await authService.completeGoogleLogin(googleUser, requestMeta(req));
  setSessionCookies(res, { accessToken, refreshToken });
  res.redirect(env.google.successRedirect);
});

export const googleFailureHandler = (_req: Request, res: Response) => {
  res.status(401).json({ success: false, message: 'Google authentication failed' });
};