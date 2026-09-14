# What's in this version — Auth v2 (Email Verification + 2FA + Cookie Sessions)

This is an update on top of the Phase 1 backend. Nothing about the broker/orders/positions/funds
modules changed — this update is entirely about **how authentication works**. Read this alongside
the main `README.md`.

## 1. Sessions are now cookie-based, not "copy the JWT into localStorage"

Every login-type endpoint (`/auth/verify-email`, `/auth/login`, `/auth/login/2fa/verify`,
`/auth/refresh`, `/auth/google/callback`) now sets **httpOnly cookies** instead of returning
tokens in the JSON body:

| Cookie | httpOnly | Purpose | Lifetime |
|---|---|---|---|
| `accessToken` | Yes | Short-lived JWT used to authenticate API calls | `JWT_ACCESS_EXPIRES_IN` (default 15m) |
| `refreshToken` | Yes | Used only by `POST /auth/refresh` to mint a new pair | `JWT_REFRESH_EXPIRES_IN` (default 7d) |
| `twofaToken` | Yes | Short-lived proof of "passed step 1, owes a 2FA code" | `JWT_TWOFA_EXPIRES_IN` (default 10m) |
| `csrfToken` | No (readable by JS) | Double-submit CSRF token, see below | matches refresh token lifetime |

The frontend doesn't need to store or attach tokens manually anymore — the browser sends
`accessToken` automatically on every request to the API's origin. `requireAuth` reads it from
the cookie. Swagger UI / Postman / mobile apps that can't rely on cookies can still send
`Authorization: Bearer <accessToken>` — `requireAuth` accepts either.

### CSRF protection

Because auth now lives in cookies, state-changing requests (POST/PUT/PATCH/DELETE) made
**via the cookie session** must also send an `x-csrf-token` header matching the `csrfToken`
cookie value (classic double-submit-cookie pattern). `requireAuth` enforces this automatically —
only for cookie-based sessions, not for `Authorization: Bearer` callers (they aren't exposed to
cross-site cookie replay in the first place).

Frontend integration is one line: read `document.cookie`'s `csrfToken` value and put it in every
mutating request's `x-csrf-token` header. The cookie is set/refreshed on every successful login,
verify, and refresh.

Set `COOKIE_SECURE=true` and an appropriate `COOKIE_SAME_SITE` in production once the frontend
is served over HTTPS on a known domain (see `.env.example`).

## 2. Manual signup now requires email verification before the account can be used at all

```
POST /auth/register  { fullName, email, password }
   -> account created with isEmailVerified = false
   -> a 6-digit OTP is emailed (logged to console in dev if SMTP isn't configured)
   -> NO session cookies are set — the account cannot log in yet

POST /auth/verify-email  { email, code }
   -> checks the OTP (hashed, expires in EMAIL_VERIFICATION_OTP_EXPIRY_MIN minutes)
   -> sets isEmailVerified = true
   -> logs the user in immediately (sets session cookies)

POST /auth/resend-verification  { email }
   -> re-sends the OTP (rate-limited by OTP_RESEND_COOLDOWN_SEC)
```

`POST /auth/login` also enforces this: if the account's email isn't verified, login is
rejected with `403` and `{ status: "requires_email_verification", email }`, and a fresh OTP is
emailed automatically so the frontend can drop the user straight into the "enter your code"
screen.

Google OAuth accounts are automatically treated as verified (Google already confirmed the
address) — no OTP step for them.

## 3. Two-Factor Authentication — opt-in, user enables it manually from settings

Per your requirement, 2FA is not forced at signup. It's something the logged-in user turns on
themselves from an account-settings screen, choosing one of two methods:

- **Email OTP** — a 6-digit code emailed at login time
- **Google Authenticator (TOTP)** — standard `otpauth://` / RFC 6238, works with Google
  Authenticator, Authy, 1Password, etc.

### Turning it on (requires an active session — the user opens this from Settings)

Google Authenticator:
```
POST /auth/2fa/totp/setup        -> { secret, keyUri, qrCodeDataUrl }
   (frontend renders qrCodeDataUrl as an <img>; user scans it)
POST /auth/2fa/totp/enable  { code }   -> confirms with a code from the app, flips 2FA on
```

Email OTP:
```
POST /auth/2fa/email/setup             -> emails a confirmation code
POST /auth/2fa/email/enable  { code }  -> confirms, flips 2FA on
```

Turning it off:
```
POST /auth/2fa/disable  { password }   -> password required for local accounts; not required
                                          for Google-only accounts (already authenticated)
```

Check current status:
```
GET /auth/2fa/status   -> { enabled, method }
```

### What happens at login once 2FA is on

```
POST /auth/login  { email, password }
   -> password correct, email verified, 2FA enabled
   -> NO session cookies yet — instead sets the short-lived `twofaToken` cookie
   -> if method = "email": also emails a fresh OTP right now
   -> responds { status: "requires_2fa", method: "email" | "totp" }

POST /auth/login/2fa/verify  { code }
   -> reads the twofaToken cookie
   -> email method: checks the OTP that was just emailed
   -> totp method: checks the code against the user's authenticator app (30s window, +/-1 step drift)
   -> on success: sets full session cookies, clears twofaToken

POST /auth/login/2fa/resend      (email method only — nothing to "resend" for an authenticator app)
```

Google OAuth logins go through the same gate: `GET /auth/google/callback` checks
`twoFactorEnabled` after Google confirms the identity, and if it's on, redirects to your frontend
with `?requires2fa=true&method=...` (and sets `twofaToken`) instead of logging straight in.

## 4. Database changes

New columns on `users` (migration `20260101000007-add-email-verification-and-2fa-to-users.js`):

- `email_verification_otp_hash`, `email_verification_otp_expires_at`, `email_verification_last_sent_at`
- `two_factor_enabled`, `two_factor_method` (`email` | `totp`)
- `two_factor_secret_encrypted` — AES-256-GCM encrypted TOTP secret (same cipher used for broker tokens)
- `two_factor_otp_hash`, `two_factor_otp_expires_at`, `two_factor_otp_last_sent_at` — used for both
  the email-2FA setup confirmation and the per-login email OTP challenge

Run `npm run db:migrate` to apply it on top of the Phase 1 schema.

## 5. New environment variables

See the fully updated `.env.example`. New sections: `JWT_TWOFA_*`, `COOKIE_*`, `OTP_*`, `SMTP_*` /
`EMAIL_FROM`, `TOTP_ISSUER`. In dev, you can leave `SMTP_HOST` empty — the mailer falls back to
printing the email (including the OTP) to the server console so you can test the whole flow
without a real mail provider. Wire up real SMTP (or an API-based provider via SMTP relay, e.g.
SendGrid/SES/Postmark's SMTP endpoints) before going to production.

## 6. Full endpoint list added/changed in this version

| Method & path | Change |
|---|---|
| `POST /auth/register` | now sends OTP, no session issued |
| `POST /auth/verify-email` | new |
| `POST /auth/resend-verification` | new |
| `POST /auth/login` | now returns `status` (`verified` / `requires_email_verification` / `requires_2fa`) instead of always returning tokens |
| `POST /auth/login/2fa/verify` | new |
| `POST /auth/login/2fa/resend` | new |
| `POST /auth/refresh` | now reads/writes the `refreshToken` cookie (body field still accepted as a fallback) |
| `POST /auth/logout` | now clears cookies instead of being a no-op |
| `GET /auth/me` | unchanged behavior, now also accepts the cookie |
| `GET /auth/google`, `GET /auth/google/callback` | callback now cookie-based, checks 2FA before logging in |
| `GET /auth/2fa/status` | new |
| `POST /auth/2fa/totp/setup` | new |
| `POST /auth/2fa/totp/enable` | new |
| `POST /auth/2fa/email/setup` | new |
| `POST /auth/2fa/email/enable` | new |
| `POST /auth/2fa/disable` | new |

All of the above are documented in Swagger (`/api-docs`) with full request/response schemas.

## 7. What did NOT change

- Broker connect (Dhan/Zerodha/Groww), Orders, Positions, Funds — untouched, still work exactly
  as in the Phase 1 README.
- `requireAuth` still attaches `req.user = { id, email, role }` the same way, so no controller in
  the broker/orders/positions/funds modules needed to change.
