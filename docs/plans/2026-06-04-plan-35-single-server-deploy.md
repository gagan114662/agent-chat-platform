# Plan 35 — Single-origin server + proxy fix + deploy artifacts (#101, #103)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD where testable.

**Design (author's call):** make the product browser-usable without two dev servers, and prep a real deploy. (1) Fix the stale vite dev proxy (#101). (2) Serve the **built web app same-origin** from the Fastify app via `@fastify/static` + SPA fallback, so it runs as ONE server on `:8080`. (3) Production multi-stage **Dockerfile** (build web → app serves `dist/`) + **fly.toml** + **DEPLOY.md**. The live `fly deploy` (Postgres provision, secrets) is run by the controller, not this plan.

**Branch** `plan-35-single-server-deploy` (off `main`). Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: fix the stale vite dev proxy (#101)

**Files:** `services/web/vite.config.ts`
- [ ] Add the missing backend path prefixes to the proxy (all → `http://localhost:8080`, `/ws` stays the ws target): `/runs`, `/tasks`, `/goals`, `/orgs`, `/agents`. Keep the existing entries. (These cover diff/approve/decline/sync/update-pr/approve-plan, reassign, goals/tick, agent share.) `cd services/web && pnpm build` (proxy is dev-only; build just confirms no syntax error). Commit `fix(web): proxy /runs /tasks /goals /orgs /agents to backend (#101)`.

## Task 1: serve the web build same-origin from the app

**Files:** `services/app/package.json` (add `@fastify/static`), `services/app/src/server.ts`, `services/app/src/static.test.ts` (or fold into an existing server test)
- [ ] **Step 1:** add `@fastify/static` dep (`pnpm --filter @acp/app add @fastify/static`). 
- [ ] **Step 2 — `server.ts`:** after all API routes are registered, if `process.env.SERVE_WEB === "1"` AND the web dist exists, register static serving:
```ts
// Serve the built web SPA same-origin (single-server prod). API routes are
// registered first so they win; everything else falls back to index.html.
if (process.env.SERVE_WEB === "1") {
  const webDist = process.env.WEB_DIST ?? new URL("../../web/dist", import.meta.url).pathname;
  const { existsSync } = await import("node:fs");
  if (existsSync(webDist)) {
    const fastifyStatic = (await import("@fastify/static")).default;
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      // SPA fallback for non-API GETs; API 404s still return JSON.
      if (req.method === "GET" && !req.url.startsWith("/auth") && !req.url.startsWith("/threads") && !req.url.startsWith("/channels") && !req.url.startsWith("/runs") && !req.url.startsWith("/tasks") && !req.url.startsWith("/goals") && !req.url.startsWith("/orgs") && !req.url.startsWith("/agents") && !req.url.startsWith("/memory") && !req.url.startsWith("/dms") && !req.url.startsWith("/repos") && !req.url.startsWith("/search") && !req.url.startsWith("/principals") && !req.url.startsWith("/ws") && !req.url.startsWith("/ws-ticket")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "not found" });
    });
  }
}
```
  (Register this AFTER all `registerX` calls and the auth preHandler. Keep it behind `SERVE_WEB` so dev/tests are unaffected.)
- [ ] **Step 3 — test:** a small test that with `SERVE_WEB` unset the server behaves as today (an unknown GET → JSON 404). (Full static serving is integration-tested by the controller locally; keep the unit light.) `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): serve web SPA same-origin behind SERVE_WEB (#103)`.

## Task 2: production Dockerfile + fly.toml + DEPLOY.md

**Files:** Create `Dockerfile` (repo root, combined web+app), `fly.toml`, `DEPLOY.md`
- [ ] **Step 1 — `Dockerfile`** (multi-stage, repo root): stage 1 `node:22-slim` + `corepack`/pnpm → `pnpm install --frozen-lockfile` → `pnpm --filter @acp/web build` (produces `services/web/dist`) → `pnpm --filter @acp/app build`. Stage 2 runtime: copy the app + `services/web/dist` + node_modules; `ENV SERVE_WEB=1 WEB_DIST=/app/services/web/dist PORT=8080`; run migrations then start (`node --import tsx services/app/src/db/migrate.ts && node --import tsx services/app/src/server.ts`, or the built JS). EXPOSE 8080. (Reuse patterns from `services/app/Dockerfile`.)
- [ ] **Step 2 — `fly.toml`:** app name `acp-web` (or similar), `internal_port = 8080`, an `http_service` with `force_https`, a `[checks]` HTTP health check on `/auth/members` or a `/healthz` (add a tiny `GET /healthz → {ok:true}` route in server.ts if none exists), `[env] SERVE_WEB=1`. Note that `DATABASE_URL`, `AUTH`/`ACP_ALLOW_DEV_HEADERS`, and any GitHub token are set as Fly **secrets** (not in fly.toml).
- [ ] **Step 3 — `DEPLOY.md`:** the exact deploy steps: `fly launch --no-deploy` (or use the committed fly.toml), `fly postgres create` + `fly postgres attach` (sets `DATABASE_URL`), `fly secrets set ACP_ALLOW_DEV_HEADERS=1` (demo) + any `E2E_GITHUB_TOKEN`, `fly deploy`. Document that the **app+web+Postgres** tier gives the chat/auth/memory/tasks UI; **live agent runs additionally need** Temporal (Temporal Cloud or a `temporal` Fly app) + the sandbox-runner Fly app (its Dockerfile exists) — list those as the second deploy step with the env vars (`TEMPORAL_ADDRESS`, `SANDBOX_URL`). Commit `chore(deploy): combined Dockerfile + fly.toml + DEPLOY.md (#103)`.

---

## Self-Review
- #101: dev proxy now covers all backend paths. #103: a single `SERVE_WEB=1` app process serves the SPA + API same-origin (no proxy in prod), a combined Docker image builds web+app, and fly.toml/DEPLOY.md make the deploy reproducible.
- Backward-compat: static serving is behind `SERVE_WEB` (dev/tests unchanged); proxy change is dev-only; new files are additive. Existing suites green.
- Note: the controller runs the actual `fly deploy` (account-bound). Full agent-run capability needs the Temporal + sandbox-runner tiers (documented in DEPLOY.md as step 2).

## Definition of Done (101, 103)
web build + app suites green; tsc clean. With `SERVE_WEB=1` and a built `services/web/dist`, the app serves the SPA at `/` and the API on the same origin; the dev proxy covers all routes; a root Dockerfile builds the combined image; fly.toml + DEPLOY.md are present. (Live URL produced by the controller's `fly deploy`.)
