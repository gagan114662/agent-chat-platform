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

## Step 2 — live agent runs (Temporal + sandbox-runner)

Agent runs are driven through Temporal and executed in the sandbox-runner. Add
these so the "run" surfaces work:

### Temporal

Use **Temporal Cloud** or deploy a `temporal` Fly app, then point the app at it:

```sh
fly secrets set TEMPORAL_ADDRESS=<host:7233> --app acp-web
# For Temporal Cloud, also configure namespace/mTLS per Temporal's docs.
```

### sandbox-runner

The sandbox-runner has its own Dockerfile at `services/sandbox-runner/Dockerfile`
(Go service, listens on `:8090`). Deploy it as a separate Fly app, then tell the
app where to reach it:

```sh
# From services/sandbox-runner, with its own fly.toml:
fly launch --no-deploy --name acp-sandbox
fly deploy --app acp-sandbox

# Point the main app at the runner (internal Fly DNS shown):
fly secrets set SANDBOX_URL=http://acp-sandbox.internal:8090 --app acp-web
```

Redeploy `acp-web` after setting `TEMPORAL_ADDRESS` / `SANDBOX_URL` so the new
secrets take effect:

```sh
fly deploy --app acp-web
```

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
