FROM golang:1.25.11 AS build
WORKDIR /src
COPY . .
RUN go build -o /bin/sandbox-runner ./cmd/server

# node base so the `claude` / `codex` CLIs the real adapters shell out to are on
# PATH (the fake adapter needs none of this). Live runs use SUBSCRIPTION auth, not
# API keys: claude-code via CLAUDE_CODE_OAUTH_TOKEN, codex via a ChatGPT login's
# auth.json (materialized by docker-entrypoint.sh from CODEX_AUTH_JSON). See
# DEPLOY.md; gate both with ACP_ALLOWED_ADAPTERS.
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y git ca-certificates && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code @openai/codex \
 && npm cache clean --force
COPY --from=build /bin/sandbox-runner /bin/sandbox-runner
COPY docker-entrypoint.sh /bin/docker-entrypoint.sh
RUN chmod +x /bin/docker-entrypoint.sh
EXPOSE 8090
ENV SANDBOX_ADDR=:8090
ENTRYPOINT ["/bin/docker-entrypoint.sh"]
