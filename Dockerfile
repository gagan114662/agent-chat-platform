# Combined single-origin image: builds the web SPA, then runs the Fastify app
# (via tsx over source) serving services/web/dist same-origin behind SERVE_WEB=1.
# Build context is the REPO ROOT. See DEPLOY.md.

# ---- Stage 1: install deps + build the web SPA --------------------------------
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
# Workspace manifests first for cached installs.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY services/orchestrator/package.json services/orchestrator/package.json
COPY services/app/package.json services/app/package.json
COPY services/web/package.json services/web/package.json
COPY services/landing/package.json services/landing/package.json
RUN pnpm install --frozen-lockfile
# Full source, then build the web app -> services/web/dist.
COPY . .
RUN pnpm --filter @acp/web build

# ---- Stage 2: runtime ---------------------------------------------------------
# The app is run via `node --import tsx src/server.ts` (no separate TS build),
# matching services/app/Dockerfile and the package.json scripts.
FROM node:22-slim AS run
RUN corepack enable \
  && apt-get update && apt-get install -y git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Bring over installed deps, app/orchestrator source, and the built web SPA.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/orchestrator/node_modules ./services/orchestrator/node_modules
COPY --from=build /app/services/app/node_modules ./services/app/node_modules
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml /app/tsconfig.base.json ./
COPY --from=build /app/services/orchestrator ./services/orchestrator
COPY --from=build /app/services/app ./services/app
COPY --from=build /app/services/web/dist ./services/web/dist
ENV NODE_ENV=production \
    SERVE_WEB=1 \
    WEB_DIST=/app/services/web/dist \
    PORT=8080
EXPOSE 8080
USER node
WORKDIR /app/services/app
# Run DB migrations, then start the single-origin server.
CMD ["sh", "-c", "node --import tsx src/db/migrate.ts && node --import tsx src/server.ts"]
