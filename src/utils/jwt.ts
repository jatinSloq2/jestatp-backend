import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: string;
}

export interface TwoFactorTokenPayload {
  sub: string; // user id
  purpose: 'login-2fa';
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn,
  } as SignOptions);
}

export function signRefreshToken(payload: Pick<JwtPayload, 'sub'>): string {
  return jwt.sign(payload, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn,
  } as SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwt.accessSecret) as JwtPayload;
}

export function verifyRefreshToken(token: string): Pick<JwtPayload, 'sub'> {
  return jwt.verify(token, env.jwt.refreshSecret) as Pick<JwtPayload, 'sub'>;
}

/** Short-lived token identifying "this user passed step 1 (password/Google) and now owes a 2FA code." */
export function signTwoFactorToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: 'login-2fa' } as TwoFactorTokenPayload, env.jwt.twoFactorSecret, {
    expiresIn: env.jwt.twoFactorExpiresIn,
  } as SignOptions);
}

export function verifyTwoFactorToken(token: string): TwoFactorTokenPayload {
  const payload = jwt.verify(token, env.jwt.twoFactorSecret) as TwoFactorTokenPayload;
  if (payload.purpose !== 'login-2fa') {
    throw new Error('Invalid token purpose');
  }
  return payload;
}

