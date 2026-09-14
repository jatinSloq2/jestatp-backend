import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { verifyAccessToken } from '../utils/jwt';
import { COOKIE_NAMES } from '../utils/cookies';
import { User } from '../models';

// req.user is typed via the global Express.User augmentation in src/types/express.d.ts
export type AuthenticatedRequest = Request;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Auth is cookie-based (httpOnly `accessToken` cookie) for the web app, but
 * also accepts a Bearer token in the Authorization header for API clients
 * (Swagger "Try it out", mobile apps, server-to-server calls) that don't
 * carry cookies. Only the cookie path is subject to the CSRF check below,
 * since Bearer-token callers aren't vulnerable to cross-site cookie replay.
 */
export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    let token: string | undefined;
    let viaCookie = false;

    if (header && header.startsWith('Bearer ')) {
      token = header.split(' ')[1];
    } else if (req.cookies?.[COOKIE_NAMES.accessToken]) {
      token = req.cookies[COOKIE_NAMES.accessToken];
      viaCookie = true;
    }

    if (!token) {
      throw ApiError.unauthorized('Not authenticated — missing access token');
    }

    const payload = verifyAccessToken(token);

    const user = await User.findByPk(payload.sub);
    if (!user || !user.isActive) {
      throw ApiError.unauthorized('User no longer exists or is inactive');
    }

    if (viaCookie && !SAFE_METHODS.has(req.method)) {
      const csrfCookie = req.cookies?.[COOKIE_NAMES.csrfToken];
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        throw ApiError.forbidden('Invalid or missing CSRF token');
      }
    }

    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(ApiError.unauthorized('Invalid or expired access token'));
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    next();
  };
}
