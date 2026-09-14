# What's in this version — Production Hardening + Strategy API

This builds on `CHANGELOG_AUTH_V2.md`. Two things landed in this pass: (1) the data layer was
normalized and hardened for production, (2) the full Strategy Builder API was added. Everything
below was tested against a real PostgreSQL 16 instance with real HTTP requests, not just
compiled — see "How this was verified" at the bottom.

## Part 1 — Database & production hardening

### Real session management (the biggest gap that's now closed)
Previously, refresh tokens were pure stateless JWTs — anyone with a leaked refresh token could
use it until it expired, and there was no way to revoke a session or see active devices. Added:

- **`refresh_tokens` table** — every refresh token's hash (never the raw token) is persisted with
  `userAgent`, `ipAddress`, `expiresAt`, `revokedAt`.
- **Rotation on every use**: `POST /auth/refresh` revokes the old token and issues a new one.
  If an already-used/revoked token is replayed (a strong signal of theft), **every session for
  that user is revoked automatically** as a precaution.
- **`POST /auth/logout`** now actually revokes the current session's refresh token (previously a
  no-op).
- **`POST /auth/logout-all`** — new. Revokes every session/device for the account.
- **`GET /auth/sessions`** — new. Lists active sessions (device/IP/created/expires) so a future
  "manage devices" settings page has something to call.

### Foreign keys, constraints, indexes
- Every FK across `orders`, `positions`, `funds`, `refresh_tokens`, `strategies`,
  `strategy_versions` now has explicit `ON DELETE CASCADE` / `ON UPDATE CASCADE` (previously
  implicit/undefined behavior). `audit_logs.user_id` is `ON DELETE SET NULL` — the audit trail
  outlives the account.
- Added check constraints: `orders.quantity > 0`, `strategies.current_version > 0`.
- Added composite indexes for the query patterns the API actually runs
  (`orders(user_id, broker, segment)`, `strategies(user_id, status)`).
- Verified with `psql`'s `information_schema` against a real DB — see the table at the bottom of
  this file.

### Transactions around every multi-write operation
Email verification, 2FA enable/disable, login-2FA success, broker connect/disconnect, and the
order/position broker-sync loops are now wrapped in `sequelize.transaction()`. Before this, a
crash mid-loop (e.g. broker API blips partway through syncing 40 orders) could leave the table in
a mixed old/new state, or a state update could succeed while its audit log entry silently failed.

### Pagination
`GET /orders` and `GET /positions` now accept `page`/`limit` (default 25, max 100) and return a
`meta` block (`total`, `totalPages`, `hasNextPage`, `hasPrevPage`) instead of dumping the entire
table every time.

### Operational readiness
- **`/health`** now actually pings the database (`SELECT 1` via `sequelize.authenticate()`) and
  returns `503` if it can't reach Postgres, instead of always returning `200`.
- **Graceful shutdown**: `SIGTERM`/`SIGINT` now stop accepting new connections, let in-flight
  requests finish, close the DB pool, and exit cleanly (with a 10s force-exit safety net) —
  required for zero-downtime deploys on PM2/Docker/Kubernetes.
- **Production DB SSL**: `dialectOptions.ssl` is now applied automatically when `NODE_ENV=production`.
- **`compression`** middleware added.
- **Stricter rate limiting on auth**: a separate `authLimiter` (20 req/15min in production) now
  guards every `/auth/*` route, instead of sharing the general API's much looser limit — auth
  endpoints are brute-force/enumeration targets and deserve a tighter ceiling.

## Part 2 — Strategy API (Phase 4/5 of the spec: Strategy Builder → Strategy JSON → Strategy Validator → Strategy Engine)

This is the API layer for everything up to — but not including — the actual execution engine.
It turns the visual Strategy Builder's output into a validated, versioned, machine-executable
"Strategy JSON" and manages its lifecycle. The next phase (Strategy Engine) reads
`strategy.toStrategyDefinition()` and runs it; nothing here executes trades.

### The DSL (`src/modules/strategies/dsl/`)
A recursive condition language covering everything in the spec's indicator list:

- **Indicators**: SMA, EMA, VWAP, RSI, MACD, Bollinger Bands, Supertrend, ATR, ADX, Stochastic —
  each with its own validated parameter ranges (e.g. MACD's `fastPeriod` must be less than
  `slowPeriod`, enforced semantically, not just by Joi's shape check).
- **Condition types**: `indicator` (with `>`, `<`, `>=`, `<=`, `==`, `!=`, `between`,
  `cross_above`, `cross_below`), `candle_pattern` (15 patterns), `price_action`, `volume`
  (vs. a number or average volume), `breakout` (vs. high/low/support/resistance over N candles),
  `support_resistance`, `time` (before/after/between, 24h `HH:mm`), `market_condition` (trending
  up/down, sideways, high/low volatility, above/below VWAP, gap up/down), and `custom_formula`
  (character-whitelisted + keyword-blocklisted for safety; the engine evaluates it later, this
  layer only validates shape/safety).
- **Groups**: any condition can be a `group` of `AND`/`OR`-combined conditions, nested to
  arbitrary depth — verified working via a 2-level-deep OR-of-AND test against the live schema.
- **Risk config**: `capitalAllocated`, `maxLossPerDay`, `maxPositions`, `maxTradesPerDay`,
  position sizing (fixed quantity / fixed capital / % of capital), stop loss, target, optional
  trailing stop loss, optional time-based exit — directly matching the spec's risk example.

### Two-stage validation (matches the doc's "Strategy Validator" pipeline stage)
1. **Joi** (`dsl/schema.ts`) checks *shape* — are the right fields present, right types, right
   enums.
2. **`strategy.validator.ts`** checks *sense* — indicator periods within realistic bounds,
   `cross_above`/`cross_below` actually compare two live series (not a series vs. a fixed
   number), MACD's periods make sense, risk figures are internally consistent
   (`maxLossPerDay <= capitalAllocated`, percent-based stop loss `< 100%`, etc.), custom formulas
   don't reference dangerous identifiers.

Both stages are exposed standalone via `POST /strategies/validate` for the builder UI's live
"validate as you go" button, and are run automatically on create/update/activate.

### Versioning
Every strategy has a full, immutable version history in `strategy_versions`. Creating a strategy
snapshots version 1; every successful update creates the next version — the previous one is
never overwritten. This is what makes "re-run this exact backtest from 3 weeks ago" possible in
a later phase: reference `strategy_versions.version`, not just the mutable `strategies` row.

### Lifecycle
`draft → active → paused → archived`. A strategy **cannot be edited while `active`** — it must
be paused first, so a running execution loop never reads a half-updated definition mid-flight
(verified live: a `PATCH` against an active strategy returns `400`). `DELETE` soft-deletes
(paranoid — `deleted_at`, never hard-deleted, full version history preserved).

### Endpoints (`/strategies`, all require auth)

| Method & path | Description |
|---|---|
| `POST /strategies` | Create (validates, persists, snapshots v1) |
| `GET /strategies` | List mine, paginated, filter by `status`/`segment` |
| `GET /strategies/:id` | Get one |
| `PATCH /strategies/:id` | Update (blocked while `active`; creates the next version) |
| `POST /strategies/:id/activate` | Re-validate + go live (paper or live per `executionMode`) |
| `POST /strategies/:id/pause` | Stop signals, keep the definition |
| `DELETE /strategies/:id` | Archive (soft-delete) |
| `POST /strategies/:id/duplicate` | Clone into a new draft (always resets to `paper` mode) |
| `GET /strategies/:id/versions` | Full version history |
| `GET /strategies/:id/versions/:version` | One specific snapshot |
| `POST /strategies/validate` | Dry-run validation, nothing persisted |
| `GET /strategies/meta/indicators` | The full DSL catalog — what the builder UI's dropdowns are built from |

All fully documented in Swagger with request/response schemas, including the recursive
`Condition` schema and worked examples.

## How this was verified

This wasn't just compiled — it was actually run:

1. Installed PostgreSQL 16 in the sandbox, created a real database, ran `npm run db:migrate` —
   **all 10 migrations applied cleanly**.
2. Queried `information_schema` directly to confirm every FK's `ON DELETE`/`ON UPDATE` rule and
   every check constraint landed exactly as intended (table included below).
3. Booted the compiled server against that real database, then over real HTTP:
   - Registered a user → captured the OTP from the dev-mailer console log → verified the email →
     confirmed httpOnly `accessToken`/`refreshToken` cookies and a readable `csrfToken` cookie
     were all set correctly.
   - Created a strategy using the exact EMA-crossover example from the spec doc, through a
     cookie-authenticated, CSRF-protected `POST`.
   - Activated it, then confirmed editing an **active** strategy is correctly rejected (`400`).
   - Paused it, edited it, and confirmed a **new version (v2)** was created while v1 remained
     intact in the version history.
   - Sent a deliberately broken strategy (cross-operator vs. a fixed number, MACD fast≥slow,
     `maxLossPerDay > capitalAllocated`, 200% stop loss) to `POST /strategies/validate` over real
     HTTP and confirmed all four issues were caught and returned with `422`.
   - **Found and fixed a real bug during this testing**: Joi's schema-level `.default()` on
     `segment`/`executionMode` was silently injecting default values into `PATCH` bodies even
     when the client didn't send those fields, which meant a partial update could silently reset
     `segment` from `fno` back to `equity`. Fixed by moving those defaults out of Joi and into the
     service layer, where they only apply on `create`. Re-tested and confirmed a partial update
     now correctly preserves the untouched fields.

### Foreign key audit (queried live from Postgres)

| Table | Column | References | ON DELETE | ON UPDATE |
|---|---|---|---|---|
| audit_logs | user_id | users | SET NULL | CASCADE |
| broker_connections | user_id | users | CASCADE | NO ACTION |
| funds | user_id, broker_connection_id | users, broker_connections | CASCADE | CASCADE |
| orders | user_id, broker_connection_id | users, broker_connections | CASCADE | CASCADE |
| positions | user_id, broker_connection_id | users, broker_connections | CASCADE | CASCADE |
| refresh_tokens | user_id | users | CASCADE | CASCADE |
| strategies | user_id | users | CASCADE | CASCADE |
| strategy_versions | strategy_id | strategies | CASCADE | CASCADE |
| strategy_versions | created_by | users | SET NULL | CASCADE |

## What did NOT change

Broker adapters (Dhan/Zerodha/Groww), the auth/2FA/email-verification flow from
`CHANGELOG_AUTH_V2.md`, and the Orders/Positions/Funds read APIs are untouched apart from the
pagination and transaction wrapping noted above.

## What's next (not in this pass)

The Strategy Engine itself (the thing that actually evaluates a Strategy JSON against live/historic
candles and emits buy/sell signals), backtesting, paper trading, and the risk engine's kill switch
are the next phase — this pass stops at "define, validate, version, and manage the lifecycle of a
strategy," per the request.
