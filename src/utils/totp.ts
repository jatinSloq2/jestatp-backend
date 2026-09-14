import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../config/env';

authenticator.options = { window: 1 }; // allow 1 step (±30s) of clock drift

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function verifyTotpToken(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

export function buildTotpKeyUri(email: string, secret: string): string {
  return authenticator.keyuri(email, env.totp.issuer, secret);
}

/** Returns a data: URI PNG the frontend can render directly in an <img> tag for scanning. */
export async function generateTotpQrCodeDataUrl(keyUri: string): Promise<string> {
  return QRCode.toDataURL(keyUri);
}
