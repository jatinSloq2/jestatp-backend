import bcrypt from 'bcryptjs';
import { env } from '../config/env';

const OTP_SALT_ROUNDS = 10;

/** Generates a numeric OTP string, e.g. "482913" (length from env.otp.length, default 6). */
export function generateOtp(length: number = env.otp.length): string {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

export async function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, OTP_SALT_ROUNDS);
}

export async function compareOtp(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash);
}

export function otpExpiryDate(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function isExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return new Date() > expiresAt;
}

/** Cooldown guard for "resend OTP" endpoints so they can't be spammed. */
export function isInCooldown(lastSentAt: Date | null, cooldownSeconds: number = env.otp.resendCooldownSeconds): boolean {
  if (!lastSentAt) return false;
  const elapsedSeconds = (Date.now() - lastSentAt.getTime()) / 1000;
  return elapsedSeconds < cooldownSeconds;
}
