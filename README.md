# Algo Trading Platform — Backend (Phase 1)

This is the **Phase 1 foundation backend** for the algo trading platform, built exactly
around the architecture described in the platform docs:

> Strategy → Trading Engine → Execution Engine → **Broker Interface** → Dhan / Zerodha / Groww

This phase covers, per the "Development Phases" table in the docs:

| Phase | What's in this backend |
|---|---|
| 1 | Core platform + authentication (JWT + Google OAuth, **email verification + opt-in 2FA**) |
| 2 | Broker connection layer (Dhan, Zerodha, Groww) |
| 3–5 | Dhan / Zerodha / Groww integrations |
| — | Live **Orders**, **Positions**, **Funds/Balance** sync, split by segment (equity delivery vs F&O) |

Strategy builder, backtesting, paper trading, the risk engine, and the full OMS lifecycle
are later phases — this repo intentionally stops at "connect a broker and see your real
orders/positions/balance," as requested.

> 📄 **See [`CHANGELOG_AUTH_V2.md`](./CHANGELOG_AUTH_V2.md)** for authentication: cookie-based
> sessions, CSRF, mandatory email verification, and opt-in 2FA (email OTP or Google Authenticator).
>
> 📄 **See [`CHANGELOG_PRODUCTION_AND_STRATEGY.md`](./CHANGELOG_PRODUCTION_AND_STRATEGY.md)** for
> the production-hardening pass (session revocation, transactions, pagination, graceful shutdown)
> and the full **Strategy API** (Strategy Builder → Strategy JSON → Validator → lifecycle).
>
> 📄 **See [`CHANGELOG_SCALABILITY.md`](./CHANGELOG_SCALABILITY.md)** for the Redis/BullMQ
> background-job architecture, distributed rate limiting, and how to run this as multiple scaled
> replicas via Docker Compose or PM2.

## Tech stack (per the provided tech-stack doc)

- **Node.js + TypeScript + Express** (kept as a modular monolith, NestJS-shaped folder layout,
  so it's a straightforward lift into NestJS modules later if you want to)
- **Sequelize + PostgreSQL** (as requested — models, migrations, and `sequelize-cli` all wired up,
  with explicit FK cascade rules, check constraints, and transactions around every multi-write
  operation — see [`CHANGELOG_PRODUCTION_AND_STRATEGY.md`](./CHANGELOG_PRODUCTION_AND_STRATEGY.md))
- **Swagger / OpenAPI** via `swagger-jsdoc` + `swagger-ui-express`, docs annotated directly on
  every route
- **JWT** access + refresh tokens delivered as **httpOnly cookies** (with a Bearer-token fallback
  for non-browser clients), **Passport Google OAuth 2.0** for one-click Google login
- **Mandatory email verification** (OTP) for manual signups, and **opt-in 2FA** (email OTP or
  Google Authenticator/TOTP) the user enables themselves from settings — see
  [`CHANGELOG_AUTH_V2.md`](./CHANGELOG_AUTH_V2.md)
- CSRF protection (double-submit cookie) for cookie-based sessions
- **Redis + BullMQ** background job queue — broker API calls happen in a separate, independently
  scalable worker process, never on the HTTP request thread — see
  [`CHANGELOG_SCALABILITY.md`](./CHANGELOG_SCALABILITY.md)
- **Docker Compose** and **PM2** deployment configs, both supporting independent horizontal
  scaling of the API and the background worker
- **AES-256-GCM** encryption for broker tokens/secrets at rest
- Helmet, CORS, rate limiting, Morgan logging, Winston logger, centralized error handling

## Project layout

```
backend/
├── src/
│   ├── config/        # env, sequelize connection, passport, swagger
│   ├── models/        # Sequelize models: User, BrokerConnection, Order, Position, Fund, AuditLog
│   ├── middlewares/    # auth guard, validation, error handler
│   ├── utils/          # jwt, AES crypto, ApiError, asyncHandler, logger
│   ├── modules/
│   │   ├── auth/        # register, login, refresh, /me, Google OAuth
│   │   ├── users/       # profile
│   │   ├── brokers/     # connect/disconnect + the BrokerAdapter layer
│   │   │   └── adapters/  # BrokerAdapter interface, DhanAdapter, ZerodhaAdapter, GrowwAdapter, factory
│   │   ├── orders/      # GET /orders (live, filterable by segment)
│   │   ├── positions/   # GET /positions (live, filterable by segment)
│   │   └── funds/       # GET /funds (balance/margin)
│   ├── routes/          # mounts all module routers
│   ├── app.ts           # express app assembly
│   └── server.ts        # entrypoint
├── migrations/          # sequelize-cli migrations for every table
├── seeders/
└── .env.example
```

## Why the broker layer is built this way

Per the architecture doc's most important rule — **"never make the strategy directly
dependent on Dhan/Zerodha/Groww"** — every broker call in this backend goes through a single
`BrokerAdapter` interface (`src/modules/brokers/adapters/brokerAdapter.interface.ts`):

```ts
interface BrokerAdapter {
  connect(credentials): Promise<{ accessToken, profile }>;
  getProfile(): Promise<BrokerProfile>;
  getFunds(): Promise<Funds>;
  getPositions(): Promise<Position[]>;
  getOrders(): Promise<Order[]>;
  placeOrder(order): Promise<OrderResponse>;
  modifyOrder(orderId, order): Promise<OrderResponse>;
  cancelOrder(orderId): Promise<OrderResponse>;
  getOrderStatus(orderId): Promise<OrderStatus>;
  getQuote(symbol): Promise<Quote>;
}
```

`DhanAdapter`, `ZerodhaAdapter`, and `GrowwAdapter` each implement it. Adding Angel One,
Upstox, or FYERS later is just one more file — nothing else in the app changes.

**No broker passwords, PINs, or OTPs ever touch our servers:**
- **Dhan** — user pastes the personal access token they generate on Dhan's own dashboard.
- **Zerodha** — full Kite Connect OAuth redirect: we send the user to Zerodha's login page,
  they authenticate (including any 2FA) directly with Zerodha, and Zerodha redirects back
  to us with a `request_token`, which we exchange for an `access_token`.
- **Groww** — user pastes the API key/secret generated from Groww's trading-API console.

All tokens/secrets are encrypted with AES-256-GCM before being stored (`src/utils/crypto.ts`)
and only decrypted in-memory when building an adapter for a live API call.

> ⚠️ Broker field names (Dhan/Zerodha/Groww request & response shapes) are implemented against
> each broker's publicly documented v1/v2 APIs as of this writing. **Verify exact field names
> against each broker's current official docs before going live** — these are the first
> integration point most likely to drift as brokers version their APIs.

## Getting started

```bash
cp .env.example .env
# edit .env — at minimum set DB_*, REDIS_URL, and a real 32-byte hex TOKEN_ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm install
createdb algo_trading            # or use your preferred Postgres client
npm run db:migrate               # runs everything in migrations/
npm run dev                      # API server: ts-node + nodemon, http://localhost:5000
npm run dev:worker                # in a second terminal: the background broker-sync worker
```

Both the API server and the worker need to be running — the API enqueues sync jobs, the worker is
what actually processes them. Without the worker running, `POST /brokers/{broker}/sync` still
returns `202` but nothing will ever pick the job up.

- Swagger UI: **http://localhost:5000/api-docs**
- Raw OpenAPI JSON: **http://localhost:5000/api-docs.json**
- Health check (checks Postgres + Redis): **http://localhost:5000/health**

## Running at scale

### Docker Compose (recommended for anything beyond local dev)
```bash
docker compose up --build --scale api=3 --scale worker=5
```
Brings up Postgres, Redis, runs migrations once, then starts 3 API replicas and 5 worker
replicas. Put a load balancer in front of the `api` service. See
[`CHANGELOG_SCALABILITY.md`](./CHANGELOG_SCALABILITY.md) for the full architecture.

### PM2 (a VM without containers)
```bash
npm run build
pm2 start ecosystem.config.js --env production
pm2 scale algo-api +2      # add API instances (cluster mode, one per core by default)
pm2 scale algo-worker +1   # add worker instances
```

### Google OAuth setup

1. Create OAuth 2.0 credentials in Google Cloud Console.
2. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`.
3. Add `http://localhost:5000/api/v1/auth/google/callback` as an authorized redirect URI.
4. Hit `GET /api/v1/auth/google` to start the flow — it redirects to
   `OAUTH_SUCCESS_REDIRECT` with `?accessToken=...&refreshToken=...` on success.

## API summary

All routes are prefixed with `/api/v1` (see `API_PREFIX` in `.env`). Full request/response
schemas are in Swagger — this is just the map.

### Auth (`/auth`) — mandatory email verification, opt-in 2FA, cookie sessions
Full detail in [`CHANGELOG_AUTH_V2.md`](./CHANGELOG_AUTH_V2.md). Summary:

| Method & path | Description |
|---|---|
| `POST /auth/register` | Email + password signup — emails an OTP, no session yet |
| `POST /auth/verify-email` | Confirm the signup OTP — logs the user in (sets cookies) |
| `POST /auth/resend-verification` | Resend the signup OTP |
| `POST /auth/login` | Returns `verified` / `requires_email_verification` / `requires_2fa` |
| `POST /auth/login/2fa/verify` | Finish login with an email OTP or authenticator code |
| `POST /auth/login/2fa/resend` | Resend the login email OTP (email 2FA method only) |
| `POST /auth/refresh` | Rotate session using the httpOnly refresh cookie |
| `POST /auth/logout` | Clears session cookies |
| `GET /auth/me` | Current user (cookie or `Authorization: Bearer`) |
| `GET /auth/google` / `GET /auth/google/callback` | Google login, 2FA-aware |
| `GET /auth/2fa/status` | Current 2FA status |
| `POST /auth/2fa/totp/setup` / `.../totp/enable` | Enable Google-Authenticator 2FA |
| `POST /auth/2fa/email/setup` / `.../email/enable` | Enable email-OTP 2FA |
| `POST /auth/2fa/disable` | Disable 2FA |

### Users (`/users`)
| Method & path | Description |
|---|---|
| `GET /users/me` | Get profile |
| `PATCH /users/me` | Update profile |

### Brokers (`/brokers`) — Phase 2
| Method & path | Description |
|---|---|
| `GET /brokers` | Supported brokers (for the "Connect Broker" screen) |
| `GET /brokers/connections` | My connections + status |
| `POST /brokers/dhan/connect` | Connect Dhan (clientId + accessToken) |
| `POST /brokers/zerodha/login-url` | Get the official Kite login URL |
| `POST /brokers/zerodha/connect` | Finish Zerodha OAuth (exchange `request_token`) |
| `POST /brokers/groww/connect` | Connect Groww (apiKey + apiSecret) |
| `DELETE /brokers/{broker}` | Disconnect / revoke |

### Trading data — read from Postgres, refreshed by the background worker
| Method & path | Description |
|---|---|
| `GET /orders?broker=dhan\|zerodha\|groww&segment=equity\|fno&page=1&limit=25` | Orders (paginated, includes `meta.lastSyncedAt`) |
| `GET /positions?broker=...&segment=...&page=1&limit=25` | Open positions (paginated) |
| `GET /funds?broker=...` | Available balance / margin used |
| `POST /brokers/{broker}/sync` | "Sync now" — queues an immediate background refresh, returns `202` |

These never call the broker's API directly on the request thread — see
[`CHANGELOG_SCALABILITY.md`](./CHANGELOG_SCALABILITY.md) for why and how.

### Strategies (`/strategies`) — Strategy Builder → Strategy JSON → Validator
Full detail in [`CHANGELOG_PRODUCTION_AND_STRATEGY.md`](./CHANGELOG_PRODUCTION_AND_STRATEGY.md).

| Method & path | Description |
|---|---|
| `POST /strategies` | Create (validated, versioned) |
| `GET /strategies` | List mine, paginated, filterable |
| `GET /strategies/:id` | Get one |
| `PATCH /strategies/:id` | Update (blocked while active; creates a new version) |
| `POST /strategies/:id/activate` / `.../pause` | Lifecycle |
| `DELETE /strategies/:id` | Archive (soft-delete) |
| `POST /strategies/:id/duplicate` | Clone into a new draft |
| `GET /strategies/:id/versions` / `.../versions/:version` | Version history |
| `POST /strategies/validate` | Dry-run validation |
| `GET /strategies/meta/indicators` | Full DSL catalog for the builder UI |

Every one of these three endpoints calls the broker's live API through the adapter,
**upserts** the result into our own Postgres tables (`orders`, `positions`, `funds` — this
is the start of the OMS/reconciliation the later phases build on), and returns the
up-to-date rows.

## Database

PostgreSQL via Sequelize, migrations in `migrations/`:

- `users` — local + Google accounts, no password for Google-only users
- `broker_connections` — one row per (user, broker), encrypted tokens, status lifecycle
- `orders` — our own OMS record, `segment` (equity/fno/currency/commodity) + broker order id
- `positions` — current holdings/positions per broker connection
- `funds` — latest balance/margin snapshot per broker connection
- `audit_logs` — auth + broker-connect/disconnect events (foundation for the audit system
  called for in later phases)

```bash
npm run db:migrate         # apply
npm run db:migrate:undo    # rollback last migration
```

## What's intentionally NOT in this phase

Per your instructions, this build stops here — the following are later phases per the docs
and are not implemented yet:
- Strategy builder / strategy engine / Strategy JSON DSL
- Backtesting & paper trading engines
- Risk engine, kill switch, OMS order-placement lifecycle beyond read/sync
- Multi-leg F&O, options chain, Greeks
- Redis/Kafka event infrastructure, WebSocket live ticks
- Billing/subscriptions, admin panel

The `BrokerAdapter` already exposes `placeOrder` / `modifyOrder` / `cancelOrder` /
`getOrderStatus` so wiring up the OMS + risk engine in the next phase is mostly service/
controller work on top of what's already here — no broker-layer rework needed.
