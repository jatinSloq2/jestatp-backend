import { Op } from 'sequelize';
import { RefreshToken } from '../../models';
import { hashToken } from '../../utils/crypto';
import { signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { parseDurationToMs } from '../../utils/duration';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';

export interface RequestMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

/**
 * Issues a brand-new refresh token JWT and persists its hash (never the raw
 * token) so it can be looked up, rotated, and revoked later — the piece a
 * pure-stateless-JWT setup is missing for real session management
 * (logout-everywhere, stolen-token revocation, device listing).
 */
export async function issueAndPersistRefreshToken(userId: string, meta: RequestMeta = {}): Promise<string> {
  const token = signRefreshToken({ sub: userId });
  await RefreshToken.create({
    userId,
    tokenHash: hashToken(token),
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null,
    expiresAt: new Date(Date.now() + parseDurationToMs(env.jwt.refreshExpiresIn)),
  });
  return token;
}

/**
 * Verifies a refresh token's JWT signature AND that its DB record is still
 * active (not revoked, not expired), then rotates it: revokes the old
 * record and issues + persists a brand-new one. Returns the new token plus
 * the user id it belongs to.
 */
export async function rotateRefreshToken(rawToken: string, meta: RequestMeta = {}): Promise<{ userId: string; newToken: string }> {
  let payload;
  try {
    payload = verifyRefreshToken(rawToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const tokenHash = hashToken(rawToken);
  const record = await RefreshToken.findOne({ where: { tokenHash } });

  if (!record || !record.isActive) {
    // Token reuse (an already-rotated/revoked token being replayed) is a strong signal
    // of theft — as a precaution, kill every session for this user if we can identify one.
    if (record?.userId) {
      await revokeAllForUser(record.userId);
    }
    throw ApiError.unauthorized('Refresh token has already been used or revoked. Please log in again.');
  }

  const newToken = signRefreshToken({ sub: payload.sub });
  const newHash = hashToken(newToken);

  await record.update({ revokedAt: new Date(), replacedByTokenHash: newHash });
  await RefreshToken.create({
    userId: payload.sub,
    tokenHash: newHash,
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null,
    expiresAt: new Date(Date.now() + parseDurationToMs(env.jwt.refreshExpiresIn)),
  });

  return { userId: payload.sub, newToken };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await RefreshToken.update({ revokedAt: new Date() }, { where: { tokenHash, revokedAt: { [Op.is]: null } } });
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await RefreshToken.update({ revokedAt: new Date() }, { where: { userId, revokedAt: { [Op.is]: null } } });
}

export async function listActiveSessions(userId: string) {
  return RefreshToken.findAll({
    where: { userId, revokedAt: { [Op.is]: null }, expiresAt: { [Op.gt]: new Date() } },
    attributes: ['id', 'userAgent', 'ipAddress', 'createdAt', 'expiresAt'],
    order: [['createdAt', 'DESC']],
  });
}
