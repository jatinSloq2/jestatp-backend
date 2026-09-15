import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.mail.host) return null; // dev fallback: no SMTP configured
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.secure,
      auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
    });
  }
  return transporter;
}

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Sends an email via SMTP if configured (SMTP_HOST set in .env).
 * In dev/local setups without SMTP configured, it logs the email (including
 * any OTP) to the server console so the flow can be tested end-to-end
 * without a real mail provider.
 */
export async function sendMail(options: SendMailOptions): Promise<void> {
  const t = getTransporter();

  if (!t) {
    logger.warn(
      `📧 [DEV MAILER — SMTP not configured] To: ${options.to} | Subject: ${options.subject}\n` +
        `----------------------------------------------------------------\n` +
        `${options.text || options.html}\n` +
        `----------------------------------------------------------------`,
    );
    return;
  }

  await t.sendMail({
    from: env.mail.from,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });
}

export function passwordResetEmailTemplate(
  resetUrl: string,
  expiryMinutes: number,
): { subject: string; html: string; text: string } {
  const subject = 'Reset your password';
  const text = `We received a request to reset your Algo Trading Platform password. Open this link to choose a new one: ${resetUrl}\nThis link expires in ${expiryMinutes} minutes. If you did not request this, you can safely ignore this email — your password will not change.`;
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
      <h2>Algo Trading Platform</h2>
      <p>We received a request to reset your password.</p>
      <p>
        <a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background: #1a73e8; color: #fff; border-radius: 6px; text-decoration: none; font-weight: bold;">
          Reset password
        </a>
      </p>
      <p style="color: #555; font-size: 13px;">Or paste this link into your browser:<br/>${resetUrl}</p>
      <p>This link expires in <strong>${expiryMinutes} minutes</strong>.</p>
      <p style="color: #888; font-size: 12px;">If you did not request this, you can safely ignore this email — your password will not change.</p>
    </div>
  `;
  return { subject, html, text };
}

export function otpEmailTemplate(purpose: string, otp: string, expiryMinutes: number): { subject: string; html: string; text: string } {
  const subject = `Your ${purpose} code: ${otp}`;
  const text = `Your verification code is ${otp}. It expires in ${expiryMinutes} minutes. If you did not request this, you can safely ignore this email.`;
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
      <h2>Algo Trading Platform</h2>
      <p>${purpose} code:</p>
      <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px;">${otp}</p>
      <p>This code expires in <strong>${expiryMinutes} minutes</strong>.</p>
      <p style="color: #888; font-size: 12px;">If you did not request this, you can safely ignore this email.</p>
    </div>
  `;
  return { subject, html, text };
}