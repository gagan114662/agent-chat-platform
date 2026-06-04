# Build context is the REPO ROOT (see deploy README). Runs the app via tsx over source.
FROM node:20-slim AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY services/orchestrator/package.json services/orchestrator/package.json
COPY services/app/package.json services/app/package.json
RUN pnpm install --frozen-lockfile

FROM node:20-slim AS run
RUN corepack enable && apt-get update && apt-get install -y git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/services/orchestrator/node_modules ./services/orchestrator/node_modules
COPY --from=deps /repo/services/app/node_modules ./services/app/node_modules
COPY . .
WORKDIR /repo/services/app
EXPOSE 8080
ENV PORT=8080
USER node
CMD ["node", "--import", "tsx", "src/server.ts"]
