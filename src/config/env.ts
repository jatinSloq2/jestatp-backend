import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  corsOrigin: process.env.CORS_ORIGIN || '*',

  db: {
    host: required('DB_HOST', 'localhost'),
    port: Number(process.env.DB_PORT) || 5432,
    name: required('DB_NAME', 'algo_trading'),
    user: required('DB_USER', 'postgres'),
    password: required('DB_PASSWORD', 'postgres'),
    dialect: (process.env.DB_DIALECT || 'postgres') as 'postgres',
    logging: process.env.DB_LOGGING === 'true',
  },

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev_access_secret'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev_refresh_secret'),
    twoFactorSecret: required('JWT_TWOFA_SECRET', 'dev_twofa_secret'),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    twoFactorExpiresIn: process.env.JWT_TWOFA_EXPIRES_IN || '10m',
  },

  cookies: {
    domain: process.env.COOKIE_DOMAIN || undefined,
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    sameSite: (process.env.COOKIE_SAME_SITE || 'lax') as 'lax' | 'strict' | 'none',
  },

  otp: {
    length: Number(process.env.OTP_LENGTH) || 6,
    emailVerificationExpiryMinutes: Number(process.env.EMAIL_VERIFICATION_OTP_EXPIRY_MIN) || 15,
    twoFactorExpiryMinutes: Number(process.env.TWO_FACTOR_OTP_EXPIRY_MIN) || 5,
    resendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SEC) || 60,
  },

  // Base URL of the frontend app — used to build links we email out (password reset, etc).
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  passwordReset: {
    expiryMinutes: Number(process.env.PASSWORD_RESET_EXPIRY_MIN) || 30,
    resendCooldownSeconds: Number(process.env.PASSWORD_RESET_RESEND_COOLDOWN_SEC) || 60,
  },

  mail: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'Algo Trading Platform <no-reply@algoplatform.local>',
  },

  totp: {
    issuer: process.env.TOTP_ISSUER || 'AlgoTradingPlatform',
  },

  encryptionKey: required(
    'TOKEN_ENCRYPTION_KEY',
    '0000000000000000000000000000000000000000000000000000000000000',
  ),

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/v1/auth/google/callback',
    successRedirect: process.env.OAUTH_SUCCESS_REDIRECT || 'http://localhost:3000/oauth/success',
    failureRedirect: process.env.OAUTH_FAILURE_REDIRECT || 'http://localhost:3000/oauth/failure',
  },

  brokers: {
    dhan: { baseUrl: process.env.DHAN_API_BASE_URL || 'https://api.dhan.co' },
    zerodha: {
      baseUrl: process.env.ZERODHA_API_BASE_URL || 'https://api.kite.trade',
      loginUrl: process.env.ZERODHA_LOGIN_URL || 'https://kite.zerodha.com/connect/login',
    },
    groww: { baseUrl: process.env.GROWW_API_BASE_URL || 'https://api.groww.in' },
  },

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 300,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  },

  sync: {
    // How stale (seconds) a segment's data can be before a GET request fires a
    // non-blocking background refresh job instead of forcing the caller to wait.
    staleThresholdSeconds: Number(process.env.SYNC_STALE_THRESHOLD_SECONDS) || 30,
    // How often (seconds) the worker's scheduler fans out a background sync job
    // to every connected broker account, independent of anyone hitting the API.
    schedulerIntervalSeconds: Number(process.env.SYNC_SCHEDULER_INTERVAL_SECONDS) || 60,
  },

  worker: {
    concurrency: Number(process.env.WORKER_CONCURRENCY) || 5,
  },
};