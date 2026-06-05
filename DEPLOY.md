# Deploy

The product ships as a **single-origin** image: the Fastify app (`@acp/app`)
serves the built web SPA (`services/web/dist`) and the JSON API on the same
origin (`:8080`), behind `SERVE_WEB=1`. The root `Dockerfile` builds the web app
and runs the server; `fly.toml` configures the Fly app `acp-web`.

There are **two deploy tiers**:

1. **App + Web + Postgres** — the chat / auth / memory / tasks / goals UI works
   end-to-end. This is what the steps below provision.
2. **Live agent runs** — additionally requires **Temporal** (Temporal Cloud or a
   `temporal` Fly app) and the **sandbox-runner** Fly app. Without these, the UI
   loads and most surfaces work, but starting an actual agent run will fail to
   reach the workflow engine. See "Step 2 — live agent runs" below.

---

## Prerequisites

- [`flyctl`](https://fly.io/docs/flyctl/install/) installed and `fly auth login`.
- This repo checked out; you run the commands from the repo root.

---

## Step 1 — App + Web + Postgres

### 1. Create the app (uses the committed `fly.toml`)

```sh
# Registers the app named in fly.toml without deploying yet.
fly launch --no-deploy --copy-config --name acp-web
# (or, if the app already exists, skip launch and just use fly.toml as-is)
```

### 2. Provision Postgres and attach it

```sh
fly postgres create --name acp-db --region iad
# Attaching sets the DATABASE_URL secret on the acp-web app automatically.
fly postgres attach acp-db --app acp-web
```

`fly postgres attach` writes a `DATABASE_URL` secret pointing at the cluster, so
you do **not** set it by hand.

### 3. Set the remaining secrets

```sh
# Demo/single-tenant auth: allow dev-header auth so the UI is usable without a
# full login backend. OMIT this in a real multi-tenant deploy.
fly secrets set ACP_ALLOW_DEV_HEADERS=1 --app acp-web

# Optional: GitHub token used by repo/PR features and e2e flows.
fly secrets set E2E_GITHUB_TOKEN=ghp_xxx --app acp-web

# Optional: Honeycomb tracing.
fly secrets set HONEYCOMB_API_KEY=xxx --app acp-web
```

Secrets (`DATABASE_URL`, `ACP_ALLOW_DEV_HEADERS`, GitHub token, etc.) live in Fly
secrets — never in `fly.toml`.

### 4. Deploy

```sh
fly deploy --app acp-web
```

The image runs DB migrations (`src/db/migrate.ts`) and then starts the server.
Fly's health check polls `GET /healthz` (returns `{"ok":true}`).

### 5. Verify

```sh
fly open --app acp-web                     # opens the SPA
curl -s https://acp-web.fly.dev/healthz    # -> {"ok":true}
```

---

## Step 2 — live agent runs (Temporal + sandbox-runner) — AS BUILT

Agent runs are driven through Temporal and executed in the sandbox-runner. This
is deployed and proven live: an `@coder` mention in a repo-bound thread drives a
real branch → PR → merge on a GitHub repo. Two extra Fly apps in org `personal`
(region `iad`) sit on the private network; the app reaches them over **flycast**
(each has a private v6 IP and a `[[services.ports]]` entry so app→app TCP works).

### Temporal (`acp-temporal`)

A single-machine Temporal **dev server** (in-memory; fine for staging, not
durable). Config: `deploy/temporal/fly.toml` (image `temporalio/temporal`,
`server start-dev --ip 0.0.0.0 --port 7233`).

```sh
fly apps create acp-temporal --org personal
fly ips allocate-v6 --private -a acp-temporal
fly deploy -c deploy/temporal/fly.toml -a acp-temporal --ha=false
```

For production durability use **Temporal Cloud** instead (set `TEMPORAL_ADDRESS`
to its host + configure namespace/mTLS per Temporal's docs).

### sandbox-runner (`acp-sandbox`)

Go service at `services/sandbox-runner` (listens `:8090`). Its image is
`node:20-bookworm-slim` + git + the `claude` and `codex` CLIs, so the `fake`
adapter and the live `claude-code` / `codex` adapters all have what they need.

```sh
fly apps create acp-sandbox --org personal
fly ips allocate-v6 --private -a acp-sandbox
fly deploy -c services/sandbox-runner/fly.toml -a acp-sandbox --remote-only --ha=false
```

### Wire the app (`acp-convene`)

```sh
fly secrets set \
  TEMPORAL_ADDRESS="acp-temporal.flycast:7233" \
  SANDBOX_URL="http://acp-sandbox.flycast:8090" \
  E2E_GITHUB_TOKEN="$(gh auth token)" \
  E2E_REPO_OWNER="<owner>" \
  E2E_REPO_NAME="<repo>" \
  --app acp-convene
```

Setting secrets restarts the app; the in-process Temporal worker reconnects on
boot (look for `Worker state changed { taskQueue: 'chat-fusion', state: 'RUNNING' }`).
Re-seed so the demo repo `r1` binds to your repo: `fly ssh console -a acp-convene
-C "node --import tsx src/db/seed.ts"`. The target repo should have a CI workflow
(GitHub Actions check-runs are honored by the merge gate) and the repo's autonomy
must be `autopilot-merge` for auto-merge.

Smoke test: log in (`POST /auth/login {memberId, password}`), then
`POST /threads/t1/messages {"body":"@coder ..."}` and poll `runs.state` for
`merged`.

### Live Claude / Codex runs (subscription auth — NOT API keys)

The `fake` adapter needs nothing more. Real `claude-code` / `codex` agents author
PRs using your **subscription** credentials (Claude Pro/Max, ChatGPT) — no
metered API keys. Both run inside `acp-sandbox`, so the secrets go there.

**Claude Code** — generate a long-lived OAuth token on a machine signed into your
Claude subscription, then set it as a secret. The `claude` CLI reads it from the
env (the sandbox env scrub preserves the `CLAUDE_` prefix even though it contains
"TOKEN"):

```sh
claude setup-token            # prints a CLAUDE_CODE_OAUTH_TOKEN (subscription)
fly secrets set \
  ACP_ALLOWED_ADAPTERS="fake,claude-code" \
  CLAUDE_CODE_OAUTH_TOKEN="<token from setup-token>" \
  --app acp-sandbox
```

**Codex** — Codex's ChatGPT-subscription auth lives in `~/.codex/auth.json` after
a `codex login`. Pass that file's contents as a secret; `docker-entrypoint.sh`
writes it to `$CODEX_HOME/auth.json` at boot:

```sh
codex login                   # ChatGPT subscription; writes ~/.codex/auth.json
fly secrets set \
  ACP_ALLOWED_ADAPTERS="fake,claude-code,codex" \
  CODEX_AUTH_JSON="$(cat ~/.codex/auth.json)" \
  --app acp-sandbox
```

Then create an agent with adapter `claude-code` (or `codex`) and mention it.
Without credentials the adapter fails closed at `Prepare` — default-deny (#38).

---

## Step 3 — Cloudflare Logpush ingestion (post-deploy, #55)

The app exposes a secret-guarded ingestion endpoint
`POST /ingest/cloudflare/:orgId` that parses Cloudflare Logpush NDJSON, detects
WAF/audit incidents, and opens Tasks (idempotent, org-scoped). Set the machine
secret and point live Logpush jobs at it post-deploy:

```sh
ACP_INGEST_SECRET=$(openssl rand -hex 32)
fly secrets set ACP_INGEST_SECRET="$ACP_INGEST_SECRET" --app acp-web
# Optional default security thread for Tasks when ?threadId= is omitted:
fly secrets set INCIDENT_THREAD_ID=<thread-id> --app acp-web
fly deploy --app acp-web
```

Full live-wiring (Logpush job creation with `CLOUDFLARE_API_TOKEN`, destination
header config, ownership challenge, verification) is in
[`docs/integrations/cloudflare-logpush.md`](docs/integrations/cloudflare-logpush.md).

---

## Local single-origin smoke test

```sh
cd services/web && pnpm build               # produces services/web/dist
cd ../app
SERVE_WEB=1 WEB_DIST="$(pwd)/../web/dist" \
  DATABASE_URL=postgres://acp:acp@localhost:5432/acp \
  node --import tsx src/server.ts
# In another shell:
curl -s localhost:8080/healthz               # -> {"ok":true}
curl -s localhost:8080/                      # -> the SPA index.html
```

In dev (two servers) nothing changes: `services/web` runs `vite` and proxies the
API paths to the app on `:8080` (see `services/web/vite.config.ts`). `SERVE_WEB`
is off by default, so dev and the test suite are unaffected.
