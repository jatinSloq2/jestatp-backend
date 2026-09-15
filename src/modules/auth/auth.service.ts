import bcrypt from 'bcryptjs';
import { sequelize, User, AuditLog } from '../../models';
import { ApiError } from '../../utils/ApiError';
import { signAccessToken, verifyTwoFactorToken, signTwoFactorToken, JwtPayload } from '../../utils/jwt';
import { generateOtp, hashOtp, compareOtp, otpExpiryDate, isExpired, isInCooldown } from '../../utils/otp';
import { sendMail, otpEmailTemplate, passwordResetEmailTemplate } from '../../utils/mailer';
import { encrypt, decrypt, hashToken } from '../../utils/crypto';
import { generateTotpSecret, verifyTotpToken, buildTotpKeyUri, generateTotpQrCodeDataUrl } from '../../utils/totp';
import crypto from 'crypto';
import { env } from '../../config/env';
import {
  issueAndPersistRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  listActiveSessions,
  RequestMeta,
} from './refreshToken.service';

const SALT_ROUNDS = 12;

async function issueTokens(user: User, meta: RequestMeta = {}) {
  const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(payload);
  const refreshToken = await issueAndPersistRefreshToken(user.id, meta);
  return { accessToken, refreshToken };
}

async function sendEmailVerificationOtp(user: User) {
  if (isInCooldown(user.emailVerificationLastSentAt)) {
    throw ApiError.badRequest(`Please wait before requesting another code`);
  }
  const otp = generateOtp();
  user.emailVerificationOtpHash = await hashOtp(otp);
  user.emailVerificationOtpExpiresAt = otpExpiryDate(env.otp.emailVerificationExpiryMinutes);
  user.emailVerificationLastSentAt = new Date();
  await user.save();

  const { subject, html, text } = otpEmailTemplate('Email verification', otp, env.otp.emailVerificationExpiryMinutes);
  await sendMail({ to: user.email, subject, html, text });
}

// ─────────────────────────── Registration ───────────────────────────

/**
 * Creates the account but does NOT issue any session tokens — the user must
 * verify their email via OTP before they can log in at all.
 */
export async function register(fullName: string, email: string, password: string) {
  const existing = await User.findOne({ where: { email: email.toLowerCase() } });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await User.create({
    fullName,
    email: email.toLowerCase(),
    passwordHash,
    authProvider: 'local',
    isEmailVerified: false,
  });

  await sendEmailVerificationOtp(user);
  await AuditLog.create({ userId: user.id, action: 'auth.register' });

  return {
    message: 'Account created. Check your email for a verification code before logging in.',
    email: user.email,
  };
}

export async function resendEmailVerification(email: string) {
  const user = await User.findOne({ where: { email: email.toLowerCase() } });
  // Don't leak account existence — always respond the same way either way.
  if (!user || user.isEmailVerified) {
    return { message: 'If an unverified account exists for this email, a new code has been sent.' };
  }
  await sendEmailVerificationOtp(user);
  return { message: 'If an unverified account exists for this email, a new code has been sent.' };
}

/** Verifies the signup OTP and — since the account is brand new and 2FA is opt-in — logs the user straight in. */
export async function verifyEmail(email: string, code: string, meta: RequestMeta = {}) {
  const user = await User.findOne({ where: { email: email.toLowerCase() } });
  if (!user) throw ApiError.badRequest('Invalid email or code');
  if (user.isEmailVerified) {
    throw ApiError.badRequest('Email is already verified. Please log in.');
  }
  if (!user.emailVerificationOtpHash || isExpired(user.emailVerificationOtpExpiresAt)) {
    throw ApiError.badRequest('Code has expired. Please request a new one.');
  }

  const isMatch = await compareOtp(code, user.emailVerificationOtpHash);
  if (!isMatch) {
    throw ApiError.badRequest('Invalid verification code');
  }

  await sequelize.transaction(async (t) => {
    user.isEmailVerified = true;
    user.emailVerificationOtpHash = null;
    user.emailVerificationOtpExpiresAt = null;
    user.lastLoginAt = new Date();
    await user.save({ transaction: t });
    await AuditLog.create({ userId: user.id, action: 'auth.email_verified' }, { transaction: t });
  });

  // A freshly-verified account can't have 2FA enabled yet (it's opt-in from settings),
  // so we can safely issue a full session right away.
  const tokens = await issueTokens(user, meta);
  return { user, ...tokens };
}

// ─────────────────────────── Login (password step) ───────────────────────────

export type LoginResult =
  | { status: 'verified'; user: User; accessToken: string; refreshToken: string }
  | { status: 'requires_email_verification'; email: string }
  | { status: 'requires_2fa'; twoFactorToken: string; method: 'email' | 'totp' };

export async function login(email: string, password: string, meta: RequestMeta = {}): Promise<LoginResult> {
  const user = await User.findOne({ where: { email: email.toLowerCase() } });
  if (!user || !user.passwordHash) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (user.authProvider !== 'local') {
    throw ApiError.badRequest(`This account uses ${user.authProvider} sign-in. Please continue with ${user.authProvider}.`);
  }
  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated');
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (!user.isEmailVerified) {
    // Proactively fire off a fresh OTP so the user can verify immediately.
    await sendEmailVerificationOtp(user).catch(() => undefined);
    return { status: 'requires_email_verification', email: user.email };
  }

  if (user.twoFactorEnabled && user.twoFactorMethod) {
    const twoFactorToken = signTwoFactorToken(user.id);

    if (user.twoFactorMethod === 'email') {
      if (isInCooldown(user.twoFactorOtpLastSentAt)) {
        // Still fine to proceed — the previously sent code is likely still valid/unexpired.
      } else {
        const otp = generateOtp();
        user.twoFactorOtpHash = await hashOtp(otp);
        user.twoFactorOtpExpiresAt = otpExpiryDate(env.otp.twoFactorExpiryMinutes);
        user.twoFactorOtpLastSentAt = new Date();
        await user.save();

        const { subject, html, text } = otpEmailTemplate('Login verification', otp, env.otp.twoFactorExpiryMinutes);
        await sendMail({ to: user.email, subject, html, text });
      }
    }

    await AuditLog.create({ userId: user.id, action: 'auth.login_2fa_challenge' });
    return { status: 'requires_2fa', twoFactorToken, method: user.twoFactorMethod };
  }

  user.lastLoginAt = new Date();
  await user.save();
  await AuditLog.create({ userId: user.id, action: 'auth.login' });

  const tokens = await issueTokens(user, meta);
  return { status: 'verified', user, ...tokens };
}

// ─────────────────────────── Login (2FA step) ───────────────────────────

export async function verifyLogin2fa(twoFactorToken: string, code: string, meta: RequestMeta = {}) {
  let payload;
  try {
    payload = verifyTwoFactorToken(twoFactorToken);
  } catch {
    throw ApiError.unauthorized('2FA session expired. Please log in again.');
  }

  const user = await User.findByPk(payload.sub);
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('User no longer exists or is inactive');
  }
  if (!user.twoFactorEnabled || !user.twoFactorMethod) {
    throw ApiError.badRequest('2FA is not enabled on this account');
  }

  let isValid = false;

  if (user.twoFactorMethod === 'totp') {
    if (!user.twoFactorSecretEncrypted) throw ApiError.internal('2FA secret missing');
    isValid = verifyTotpToken(code, decrypt(user.twoFactorSecretEncrypted));
  } else {
    if (!user.twoFactorOtpHash || isExpired(user.twoFactorOtpExpiresAt)) {
      throw ApiError.badRequest('Code has expired. Please request a new one.');
    }
    isValid = await compareOtp(code, user.twoFactorOtpHash);
  }

  if (!isValid) {
    throw ApiError.unauthorized('Invalid 2FA code');
  }

  await sequelize.transaction(async (t) => {
    user.twoFactorOtpHash = null;
    user.twoFactorOtpExpiresAt = null;
    user.lastLoginAt = new Date();
    await user.save({ transaction: t });
    await AuditLog.create({ userId: user.id, action: 'auth.login_2fa_success' }, { transaction: t });
  });

  const tokens = await issueTokens(user, meta);
  return { user, ...tokens };
}

export async function resendLogin2faOtp(twoFactorToken: string) {
  let payload;
  try {
    payload = verifyTwoFactorToken(twoFactorToken);
  } catch {
    throw ApiError.unauthorized('2FA session expired. Please log in again.');
  }

  const user = await User.findByPk(payload.sub);
  if (!user || !user.twoFactorEnabled || user.twoFactorMethod !== 'email') {
    throw ApiError.badRequest('Email-based 2FA is not active for this session');
  }
  if (isInCooldown(user.twoFactorOtpLastSentAt)) {
    throw ApiError.badRequest('Please wait before requesting another code');
  }

  const otp = generateOtp();
  user.twoFactorOtpHash = await hashOtp(otp);
  user.twoFactorOtpExpiresAt = otpExpiryDate(env.otp.twoFactorExpiryMinutes);
  user.twoFactorOtpLastSentAt = new Date();
  await user.save();

  const { subject, html, text } = otpEmailTemplate('Login verification', otp, env.otp.twoFactorExpiryMinutes);
  await sendMail({ to: user.email, subject, html, text });

  return { message: 'A new code has been sent to your email' };
}

// ─────────────────────────── Forgot / reset password ───────────────────────────

/**
 * Issues a one-time password-reset link, emailed to the account if it exists.
 * Always responds with the same message regardless of whether the account
 * exists (avoids leaking which emails are registered). Google-only accounts
 * (no passwordHash) have nothing to reset, so no email is sent for them either.
 */
export async function forgotPassword(email: string) {
  const genericResult = { message: 'If an account exists for this email, a reset link has been sent.' };

  const user = await User.findOne({ where: { email: email.toLowerCase() } });
  if (!user || user.authProvider !== 'local') {
    return genericResult;
  }
  if (isInCooldown(user.resetPasswordLastSentAt, env.passwordReset.resendCooldownSeconds)) {
    return genericResult;
  }

  // The raw token goes in the emailed link; only its hash is ever persisted,
  // mirroring how refresh tokens are stored (see utils/crypto.hashToken).
  const rawToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordTokenHash = hashToken(rawToken);
  user.resetPasswordExpiresAt = new Date(Date.now() + env.passwordReset.expiryMinutes * 60 * 1000);
  user.resetPasswordLastSentAt = new Date();
  await user.save();

  const resetUrl = `${env.frontendUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;
  const { subject, html, text } = passwordResetEmailTemplate(resetUrl, env.passwordReset.expiryMinutes);
  await sendMail({ to: user.email, subject, html, text });

  await AuditLog.create({ userId: user.id, action: 'auth.password_reset_requested' });

  return genericResult;
}

/** Consumes a password-reset token (from the emailed link) and sets a new password. */
export async function resetPassword(token: string, newPassword: string) {
  const tokenHash = hashToken(token);
  const user = await User.findOne({ where: { resetPasswordTokenHash: tokenHash } });

  if (!user || isExpired(user.resetPasswordExpiresAt)) {
    throw ApiError.badRequest('This reset link is invalid or has expired. Please request a new one.');
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await sequelize.transaction(async (t) => {
    user.passwordHash = passwordHash;
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpiresAt = null;
    await user.save({ transaction: t });
    await AuditLog.create({ userId: user.id, action: 'auth.password_reset_completed' }, { transaction: t });
  });

  // A reset password is a strong signal to kill every other session — if
  // someone else had access to the account, this cuts them off immediately.
  await revokeAllForUser(user.id);

  return { message: 'Your password has been reset. Please log in with your new password.' };
}

// ─────────────────────────── Refresh / Logout / Sessions ───────────────────────────

/**
 * Rotates the refresh token: the old one is revoked and a new access+refresh
 * pair is issued. If a token that's already been rotated/revoked is replayed
 * (possible token theft), every session for that user is revoked as a precaution.
 */
export async function refresh(refreshToken: string, meta: RequestMeta = {}) {
  const { userId, newToken } = await rotateRefreshToken(refreshToken, meta);

  const user = await User.findByPk(userId);
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('User no longer exists or is inactive');
  }

  const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(payload);
  return { user, accessToken, refreshToken: newToken };
}

export async function logout(refreshToken: string | undefined, userId?: string) {
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  if (userId) {
    await AuditLog.create({ userId, action: 'auth.logout' });
  }
}

export async function logoutAllDevices(userId: string) {
  await revokeAllForUser(userId);
  await AuditLog.create({ userId, action: 'auth.logout_all' });
  return { message: 'All sessions have been logged out' };
}

export async function getMySessions(userId: string) {
  return listActiveSessions(userId);
}

// ─────────────────────────── Google OAuth ───────────────────────────

/**
 * Called from the Passport Google strategy verify callback.
 * Finds an existing user by googleId/email, or creates a new one.
 * Google accounts are treated as email-verified automatically (Google
 * already verified the address). No tokens are issued here — the
 * controller decides whether a 2FA challenge is needed first.
 */
export async function findOrCreateGoogleUser(profile: {
  googleId: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
}) {
  let user = await User.findOne({ where: { googleId: profile.googleId } });

  if (!user) {
    user = await User.findOne({ where: { email: profile.email.toLowerCase() } });
    if (user) {
      // Existing local account signing in with Google for the first time — link it.
      user.googleId = profile.googleId;
      user.authProvider = 'google';
      user.avatarUrl = profile.avatarUrl ?? user.avatarUrl;
      user.isEmailVerified = true;
      await user.save();
    } else {
      user = await User.create({
        fullName: profile.fullName,
        email: profile.email.toLowerCase(),
        passwordHash: null,
        authProvider: 'google',
        googleId: profile.googleId,
        avatarUrl: profile.avatarUrl ?? null,
        isEmailVerified: true,
      });
    }
  }

  await AuditLog.create({ userId: user.id, action: 'auth.google_login' });
  return user;
}

export async function completeGoogleLogin(user: User, meta: RequestMeta = {}) {
  user.lastLoginAt = new Date();
  await user.save();
  return issueTokens(user, meta);
}

// ─────────────────────────── 2FA management (user opts in from settings) ───────────────────────────

export async function getTwoFactorStatus(userId: string) {
  const user = await User.findByPk(userId);
  if (!user) throw ApiError.notFound('User not found');
  return { enabled: user.twoFactorEnabled, method: user.twoFactorMethod };
}

/** Step 1 of enabling Google-Authenticator-style 2FA: generate + return a QR code to scan. */
export async function initiateTotpSetup(userId: string) {
  const user = await User.findByPk(userId);
  if (!user) throw ApiError.notFound('User not found');
  if (user.twoFactorEnabled) throw ApiError.badRequest('2FA is already enabled. Disable it first to switch methods.');

  const secret = generateTotpSecret();
  user.twoFactorSecretEncrypted = encrypt(secret);
  await user.save();

  const keyUri = buildTotpKeyUri(user.email, secret);
  const qrCodeDataUrl = await generateTotpQrCodeDataUrl(keyUri);

  return { secret, keyUri, qrCodeDataUrl };
}

/** Step 2: user enters the 6-digit code from their authenticator app to confirm setup. */
export async function confirmTotpSetup(userId: string, code: string) {
  const user = await User.findByPk(userId);
  if (!user) throw ApiError.notFound('User not found');
  if (!user.twoFactorSecretEncrypted) {
    throw ApiError.badRequest('No pending TOTP setup found. Start setup again.');
  }

  const secret = decrypt(user.twoFactorSecretEncrypted);
  if (!verifyTotpToken(code, secret)) {
    throw ApiError.badRequest('Invalid code. Check your authenticator app and try again.');
  }

  user.twoFactorEnabled = true;
  user.twoFactorMethod = 'totp';
  await sequelize.transaction(async (t) => {
    await user.save({ transaction: t });
    await AuditLog.create({ userId: user.id, action: 'auth.2fa_enabled', metadata: { method: 'totp' } }, { transaction: t });
  });

  return { enabled: true, method: 'totp' as const };
}

/** Step 1 of enabling email-OTP 2FA: send a confirmation code to the user's own email. */
export async function initiateEmailTwoFactorSetup(userId: string) {
  const user = await User.findByPk(userId);
  if (!user) throw ApiError.notFound('User not found');
  if (user.twoFactorEnabled) throw ApiError.badRequest('2FA is already enabled. Disable it first to switch methods.');
  if (isInCooldown(user.twoFactorOtpLastSentAt)) {
    throw ApiError.badRequest('Please wait before requesting another code');
  }

  const otp = generateOtp();
  user.twoFactorOtpHash = await hashOtp(otp);
  user.twoFactorOtpExpiresAt = otpExpiryDate(env.otp.twoFactorExpiryMinutes);
  user.twoFactorOtpLastSentAt = new Date();
  await user.save();

  const { subject, html, text } = otpEmailTemplate('2FA setup confirmation', otp, env.otp.twoFactorExpiryMinutes);
  await sendMail({ to: user.email, subject, html, text });

  return { message: 'Confirmation code sent to your email' };
}

/** Step 2: user enters the code emailed above to confirm email-OTP 2FA. */
export async function confirmEmailTwoFactorSetup(userId: string, code: string) {
  const user = await User.findByPk(userId);
  if (!user) throw ApiError.notFound('User not found');
  if (!user.twoFactorOtpHash || isExpired(user.twoFactorOtpExpiresAt)) {
    throw ApiError.badRequest('Code has expired. Please request a new one.');
  }

  const isMatch = await compareOtp(code, user.twoFactorOtpHash);
  if (!isMatch) throw ApiError.badRequest('Invalid code');

  user.twoFactorEnabled = true;
  user.twoFactorMethod = 'email';
  user.twoFactorOtpHash = null;
  user.twoFactorOtpExpiresAt = null;
  await sequelize.transaction(async (t) => {
    await user.save({ transaction: t });
    await AuditLog.create({ userId: user.id, action: 'auth.2fa_enabled', metadata: { method: 'email' } }, { transaction: t });
  });

  return { enabled: true, method: 'email' as const };
}

export async function disableTwoFactor(userId: string, password?: string) {
  const user = await User.findByPk(userId);
  if (!user) throw ApiError.notFound('User not found');
  if (!user.twoFactorEnabled) throw ApiError.badRequest('2FA is not enabled on this account');

  if (user.authProvider === 'local') {
    if (!password || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw ApiError.unauthorized('Incorrect password');
    }
  }

  user.twoFactorEnabled = false;
  user.twoFactorMethod = null;
  user.twoFactorSecretEncrypted = null;
  user.twoFactorOtpHash = null;
  user.twoFactorOtpExpiresAt = null;
  await sequelize.transaction(async (t) => {
    await user.save({ transaction: t });
    await AuditLog.create({ userId: user.id, action: 'auth.2fa_disabled' }, { transaction: t });
  });

  return { enabled: false };
}