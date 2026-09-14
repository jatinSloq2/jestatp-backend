# ── Stage 1: build ───────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: production dependencies only ───────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 3: migrator — full devDependencies (needs sequelize-cli), used
# as a one-off container to apply migrations before the app starts, NOT
# for serving traffic. See the `migrate` service in docker-compose.yml. ─
FROM node:20-alpine AS migrator
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY package.json .sequelizerc ./
COPY src/config/sequelize-cli.config.js ./src/config/sequelize-cli.config.js
COPY migrations ./migrations
COPY seeders ./seeders
CMD ["npx", "sequelize-cli", "db:migrate"]

# ── Stage 4: runtime image ───────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Non-root user — never run the process as root in production
RUN addgroup -g 1001 nodejs && adduser -S -u 1001 -G nodejs appuser

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:5000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Default command runs the API server; the worker service in docker-compose.yml
# overrides this with `node dist/worker.js`. Same image, two roles, scaled
# independently — see docker-compose.yml.
CMD ["node", "dist/server.js"]
