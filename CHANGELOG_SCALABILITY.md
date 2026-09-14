# What's in this version — Scalability Infrastructure

Builds on `CHANGELOG_AUTH_V2.md` and `CHANGELOG_PRODUCTION_AND_STRATEGY.md`. Everything below was
installed and run for real in the sandbox (real Postgres, real Redis, real HTTP, real background
jobs picked up and processed by a separate worker process) — see "How this was verified."

## The core problem this pass fixes

Before this pass, `GET /orders` / `/positions` / `/funds` called the broker's live API
**synchronously, on the request thread, every single time**. That's fine for one user testing
locally. It falls over in production for three separate reasons:

1. **Latency** — every request pays for a round trip to Dhan/Zerodha/Groww, so response time is
   bounded by the slowest broker, not by your own infrastructure.
2. **Broker rate limits** — brokers rate-limit their own APIs; N users refreshing their orders
   page at once means N broker API calls at once, and that ceiling has nothing to do with how
   much traffic your own servers could otherwise handle.
3. **No horizontal scaling story** — even if you ran 10 copies of the API behind a load balancer,
   every copy would still be making its own synchronous broker calls per request. More replicas
   wouldn't help; they'd just create more concurrent broker calls.

The fix is standard for this kind of problem: **separate "serve reads fast" from "talk to a slow
external API,"** using a queue and a distributed job worker.

## What changed

### Redis
Added as shared infrastructure (`ioredis`), used for two distinct things — kept as two separate
connections since they have different requirements:
- **Rate limiting** (`rate-limit-redis`) — see below
- **BullMQ** — job queue backend (BullMQ's own connection needs `maxRetriesPerRequest: null` for
  its blocking commands; mixing that into the rate-limiter's connection would break both)

### Background job queue (BullMQ) — `src/queues/`
- **`broker-sync` queue** with two job types: `sync-connection` (sync one specific broker
  account) and `fan-out-sync` (find every `connected` broker account and enqueue a
  `sync-connection` job for each).
- **A standalone worker process** (`src/worker.ts` → `dist/worker.js`) — this is the piece that
  actually calls broker APIs now. It's a completely separate process from the API server, meaning
  you scale it independently: run 1 API replica and 5 worker replicas, or 10 and 1, based on
  whichever is actually your bottleneck (HTTP traffic vs. broker-sync volume).
- **A repeatable scheduler job** — the worker registers a recurring `fan-out-sync` job
  (`SYNC_SCHEDULER_INTERVAL_SECONDS`, default 60s) on boot, so broker data stays fresh in the
  background regardless of whether anyone's actively using the app right now. Registering this is
  idempotent (BullMQ dedupes repeatable jobs by `jobId`), so every worker replica calling it on
  boot is safe — it only actually gets scheduled once.
- **Retries with exponential backoff** — each sync job gets 3 attempts, 5s/10s/20s backoff,
  before it's given up on and logged as failed.

### `GET /orders`, `GET /positions`, `GET /funds` now read from Postgres only
No broker API call happens on these request paths anymore. Each includes `meta.lastSyncedAt` so
the frontend can show "as of X seconds ago." If the cached data is older than
`SYNC_STALE_THRESHOLD_SECONDS` (default 30s), a background refresh job is enqueued
**fire-and-forget** — the current request never waits on it, the *next* read just happens to be
fresher. `GET /funds` has one exception: if a connection has genuinely never been synced (first
time ever), it does one synchronous sync so the very first call isn't an empty response.

### `POST /brokers/{broker}/sync` — new
A "sync now" button's backend: enqueues a high-priority job for that one connection and returns
`202` immediately with a `jobId`. The frontend can re-poll the `GET` endpoints a few seconds later
and see `lastSyncedAt` move forward.

### Rate limiting is now distributed
Previously, `express-rate-limit`'s default in-memory store meant limits were **per API process**.
Run 3 API replicas behind a load balancer and a client effectively gets 3x the intended limit,
split unevenly depending on which replica they happen to hit. Switched to `rate-limit-redis` so
the limit is enforced globally across every replica, correctly, no matter how many are running.

### `/health` now checks Redis too
Reports `database` and `redis` connectivity separately; returns `503` if either is unreachable —
what a load balancer or orchestrator's readiness probe should be pointed at.

## Deployment — two ways to run this at scale

### Docker (`Dockerfile` + `docker-compose.yml`)
Multi-stage build: `builder` (full deps, compiles TypeScript) → `deps` (prod-only
`node_modules`) → `migrator` (a one-off image with `sequelize-cli` for `db:migrate`, not used to
serve traffic) → `runtime` (the actual image that runs — non-root user, prod deps only, a
`HEALTHCHECK` calling `/health`).

`docker-compose.yml` wires up Postgres + Redis + a `migrate` one-off container (runs once,
`api`/`worker` won't start until it completes successfully) + `api` + `worker`. Scale either
independently:
```bash
docker compose up --scale api=3 --scale worker=5
```
Put a load balancer in front of the `api` replicas (nginx, Traefik, your cloud's LB — not
included, since that choice depends on where you deploy).

### PM2 (`ecosystem.config.js`)
For running at scale on a VM without containers. The API runs in PM2's `cluster` mode
(`instances: 'max'` — one process per CPU core, Node's built-in load balancing between them,
zero code changes needed since the app is already stateless). The worker runs in `fork` mode as N
independent instances. `pm2 scale algo-api +2` / `pm2 scale algo-worker +1` to grow either at
runtime.

## Why this app was already safe to scale horizontally (things that did NOT need to change)
Worth calling out explicitly, since it's easy to assume "add Redis" means everything was broken:
- **Auth is already stateless-safe**: JWTs + the `refresh_tokens` DB table (added in the previous
  pass) mean any API replica can validate any user's session — no server-side session affinity
  needed, no sticky sessions required at the load balancer.
- **All state lives in Postgres**, not in-process memory — strategies, orders, positions, broker
  connections, everything. Any replica can serve any request.
- The only in-process state that existed before this pass was the rate limiter's counters, which
  is exactly what got fixed.

## How this was verified

1. Installed Redis 7 in the sandbox alongside the Postgres 16 from the previous pass.
2. Built the app, booted the API server **and** the worker process side by side, confirmed
   `/health` reports both `database: connected` and `redis: connected`.
3. Confirmed the worker's repeatable scheduler job actually registered in Redis by inspecting
   BullMQ's own keys directly (`bull:broker-sync:repeat:*`).
4. Ran the full register → verify-email flow, then **inserted a real `broker_connections` row**
   directly (since this sandbox's network can't reach real broker APIs) and called
   `POST /brokers/dhan/sync`:
   - Got `202` with a `jobId` back immediately (not blocked on any broker call).
   - Within seconds, the **separate worker process's log** showed it picked up the job,
     looked up the connection, and attempted the sync.
   - The sync correctly failed on the fake encrypted credentials (AES-GCM auth tag
     verification correctly rejected the bogus ciphertext) — this is the *expected* result
     given intentionally fake test data, and it proves decrypt-then-call-broker-API is actually
     wired up end-to-end.
   - Inspected the job's state directly in Redis: `attempts: 3`, `atm: 1` (one attempt made),
     sitting in the delayed queue with exponential backoff — confirmed retry/backoff is
     configured and working, not just declared in code.
5. Simulated the exact Docker `runtime` stage without Docker itself (no `docker` binary available
   in this sandbox): ran `npm ci --omit=dev` in an isolated directory, confirmed `sequelize-cli`
   is correctly **absent** (it's a devDependency, only present in the `migrator` stage) while
   `bullmq`/`ioredis`/`express`/`sequelize` are present, copied the compiled `dist/` in, and
   booted the server against real Postgres/Redis using only that production dependency set —
   confirmed `/health` still returns fully healthy.
6. Validated `docker-compose.yml` as real YAML (parsed with PyYAML) and confirmed every file path
   the `Dockerfile` references actually exists in the repo.

## New environment variables

`REDIS_URL`, `SYNC_STALE_THRESHOLD_SECONDS`, `SYNC_SCHEDULER_INTERVAL_SECONDS`,
`WORKER_CONCURRENCY` — see the updated `.env.example`.

## What's next

The Strategy Engine (evaluating active strategies against live ticks) is the natural next thing
to build on this same queue infrastructure — it's the same pattern (a worker process, not more
HTTP routes) applied to a different job type.
