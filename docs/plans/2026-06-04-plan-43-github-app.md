# Plan 43 — GitHub App: webhook handler + installation auth (#23)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** replace the PAT with a GitHub App (App ID `3965781`, Client ID configured). Two buildable cores: (1) a **signature-verified webhook** (`POST /webhooks/github`) that maps an event's repo → our `repos` row → org and handles `issues.opened` → Task (idempotent, reusing the #22 id scheme) + `ping`; (2) an **App installation-token client** (`@octokit/auth-app`, env `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY`) as the PAT replacement. Live use needs the **private key (.pem)** + **webhook secret** + the public **webhook URL** (post-deploy #103) — built against env names, unit-tested with a test secret/key.

**Branch** `plan-43-github-app` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: webhook handler (signature-verified → issues→Task)

**Files:** Create `services/app/src/integrations/github-webhook.ts`, `github-webhook.test.ts`, `src/http/webhook-routes.ts`, `webhook-routes.test.ts`; Modify `src/server.ts`, `src/http/auth-routes.ts` (bypass the user preHandler for `/webhooks/*`, like `/ingest/*`)
- [ ] **Step 1 — `github-webhook.ts`:** `verifyGitHubSignature(secret, rawBody, sigHeader): boolean` — compute `sha256=` HMAC over the raw body, **timing-safe** compare (`crypto.timingSafeEqual`) to `X-Hub-Signature-256`. `false` if secret unset or header missing.
- [ ] **Step 2 — `webhook-routes.ts`:** `registerWebhookRoutes(app, d: { db, sql })`: `POST /webhooks/github` —
  - Read the **raw body** (add a content-type parser that keeps the raw buffer for HMAC; Fastify needs the raw body — register a `contentTypeParser` for `application/json` on this route that stores raw + parses, or use `req.rawBody`). Verify `verifyGitHubSignature(process.env.GITHUB_APP_WEBHOOK_SECRET, raw, req.headers["x-hub-signature-256"])` → 401 if invalid.
  - `event = req.headers["x-github-event"]`. `ping` → `{ ok: true }`. `issues` with `action==="opened"` → map `payload.repository.{owner.login,name}` → our `repos` row (find by githubOwner/githubName) → its `orgId` + a thread (the repo's default/incident thread or skip if none); create a Task id `gh:${owner}/${repo}#${number}` (idempotent, `onConflictDoNothing`) — reuse `importGitHubIssues`' task shape. Unknown repo → `{ ok: true, ignored: true }` (200). Other events → 200 ignored.
  - Register in `server.ts`; bypass the #37 user preHandler for `/webhooks/*` (its own HMAC auth).
- [ ] **Step 3 — tests:** `github-webhook.test.ts` — valid HMAC verifies, tampered body / wrong secret / missing header → false. `webhook-routes.test.ts` (`app.inject`, set `GITHUB_APP_WEBHOOK_SECRET`, compute the real signature header): `ping` → 200; `issues.opened` for a seeded repo → a Task created (`gh:...#n`), re-deliver same → idempotent (no dup); unknown repo → 200 ignored; bad signature → 401. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): signature-verified GitHub webhook → issues→Task (#23)`.

## Task 1: App installation-token client (PAT replacement)

**Files:** `services/app/package.json` (add `@octokit/auth-app`), Create `services/app/src/integrations/github-app.ts`, `github-app.test.ts`; `docs/integrations/github-app.md`
- [ ] **Step 1:** add `@octokit/auth-app`. `github-app.ts`: `makeAppInstallationClient(installationId: number)` → builds an Octokit authenticated as the App installation using `appId = Number(process.env.GITHUB_APP_ID)`, `privateKey = process.env.GITHUB_APP_PRIVATE_KEY` (PEM), via `createAppAuth`/Octokit's `authStrategy`. Throw a clear error if `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` unset. (This returns an Octokit that mints installation tokens on demand — the PAT replacement for `OctokitGitHubService`.)
- [ ] **Step 2 — test:** with `GITHUB_APP_ID` + a **generated test RSA private key** in env (generate one in the test via `crypto.generateKeyPairSync("rsa",...)` — no real GitHub call), `makeAppInstallationClient(123)` returns an Octokit instance without throwing; with the env unset it throws the clear error. (Live token exchange needs the real App key + a network call — out of scope for the unit test.)
- [ ] **Step 3 — `docs/integrations/github-app.md`:** document the remaining live-wiring: generate + download the App **private key (.pem)** → set `GITHUB_APP_PRIVATE_KEY` (Fly secret, PEM contents); set `GITHUB_APP_WEBHOOK_SECRET` (any strong random) on both the App's webhook config and our env; after deploy (#103) set the App **Webhook URL** to `https://<deploy>/webhooks/github`; the App ID (3965781) + Client ID are set. Note that `OctokitGitHubService` can be swapped to `makeAppInstallationClient` per repo once installation ids are mapped (a follow-up: an `installations` table). Commit `feat(app): GitHub App installation-token client + docs (#23)`.

---

## Self-Review
- Delivers #23's buildable cores: a timing-safe, signature-verified webhook that turns `issues.opened` into Tasks (idempotent, repo→org mapped) and an App installation-token client to replace the PAT — both env-driven, unit-tested with test secrets/keys (no live GitHub calls).
- Backward-compat: additive routes/modules + the `/webhooks/*` preHandler bypass (its own HMAC auth, like `/ingest/*`); the PAT path (`OctokitGitHubService`) is untouched until installations are mapped. Existing suites green.
- Note: live use needs the **.pem + client secret + webhook secret + post-deploy URL** (user-provided). Auto PR-comment/check webhooks → run actions, and the `installations`→org map, are follow-ups on this foundation.

## Definition of Done (23)
app suite green; tsc. `POST /webhooks/github` verifies the HMAC signature (401 on bad), turns `issues.opened` into idempotent org-mapped Tasks, ignores unknown repos/events; `makeAppInstallationClient` builds an App-authed Octokit from env (throws clearly when unset). Live wiring documented (.pem/secret/URL pending).
