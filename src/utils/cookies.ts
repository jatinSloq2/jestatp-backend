import crypto from 'crypto';
import { CookieOptions, Response } from 'express';
import { env } from '../config/env';
import { parseDurationToMs } from './duration';

export const COOKIE_NAMES = {
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  twoFactorToken: 'twofaToken',
  csrfToken: 'csrfToken',
} as const;



function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.cookies.secure,
    sameSite: env.cookies.sameSite,
    domain: env.cookies.domain,
    path: '/',
  };
}

export function setAccessTokenCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAMES.accessToken, token, {
    ...baseCookieOptions(),
    maxAge: parseDurationToMs(env.jwt.accessExpiresIn),
  });
}

export function setRefreshTokenCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAMES.refreshToken, token, {
    ...baseCookieOptions(),
    maxAge: parseDurationToMs(env.jwt.refreshExpiresIn),
  });
}

/** Short-lived cookie used only while a login is mid-flight awaiting a 2FA code. */
export function setTwoFactorCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAMES.twoFactorToken, token, {
    ...baseCookieOptions(),
    maxAge: parseDurationToMs(env.jwt.twoFactorExpiresIn),
  });
}

/**
 * Readable (non-httpOnly) double-submit CSRF cookie. The frontend reads this
 * value and sends it back as an `x-csrf-token` header on mutating requests;
 * requireAuth compares the two when the request was authenticated via cookie.
 */
export function setCsrfCookie(res: Response): string {
  const csrfToken = crypto.randomBytes(24).toString('hex');
  res.cookie(COOKIE_NAMES.csrfToken, csrfToken, {
    httpOnly: false,
    secure: env.cookies.secure,
    sameSite: env.cookies.sameSite,
    domain: env.cookies.domain,
    path: '/',
    maxAge: parseDurationToMs(env.jwt.refreshExpiresIn),
  });
  return csrfToken;
}

/** Sets the full authenticated session: access + refresh + CSRF cookies. */
export function setSessionCookies(res: Response, tokens: { accessToken: string; refreshToken: string }) {
  setAccessTokenCookie(res, tokens.accessToken);
  setRefreshTokenCookie(res, tokens.refreshToken);
  setCsrfCookie(res);
}

export function clearSessionCookies(res: Response) {
  const opts = baseCookieOptions();
  res.clearCookie(COOKIE_NAMES.accessToken, opts);
  res.clearCookie(COOKIE_NAMES.refreshToken, opts);
  res.clearCookie(COOKIE_NAMES.csrfToken, { ...opts, httpOnly: false });
}

export function clearTwoFactorCookie(res: Response) {
  res.clearCookie(COOKIE_NAMES.twoFactorToken, baseCookieOptions());
}
