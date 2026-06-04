# Plan 42 — Cloudflare Logpush ingestion → incidents → Tasks (#55)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** consume Cloudflare telemetry directly via Logpush (no Flarehawk — #54 has no API). An ingestion endpoint accepts Logpush NDJSON batches, parses them, runs simple detection (WAF blocks, sensitive audit actions) → **incidents** → **Tasks** in a security thread, idempotent + org-scoped, secret-guarded + size-capped. The **live Logpush job** (pointing at the public URL, created with `CLOUDFLARE_API_TOKEN`) is post-deploy (#103) — documented, not wired here. This also generalizes toward the observability log-ingestion issue (#95).

**Branch** `plan-42-cloudflare-ingest` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: incidents + detection

**Files:** `services/app/src/db/schema.ts` + next migration (`0014_incidents.sql` — confirm next contiguous in `services/app/migrations`), Create `src/integrations/cloudflare.ts`, `cloudflare.test.ts`
- [ ] **Step 1 — schema/migration:** `incidents` table: `id` (pk), `orgId`, `source` (text, e.g. "cloudflare"), `severity` (text), `title`, `body`, `raw` (jsonb), `taskId` (nullable), `createdAt` (defaultNow). `pnpm db:migrate`.
- [ ] **Step 2 — `cloudflare.ts`:**
  - `parseLogpush(ndjson: string): Record<string, unknown>[]` — split on newlines, `JSON.parse` each non-empty line, skip/ignore malformed lines (bounded).
  - `detectIncidents(records, opts?): { key: string; severity: string; title: string; body: string; raw: unknown }[]` — rules:
    - **WAF/firewall blocks:** records with `Action` (case-insensitive) in {block, challenge, jschallenge, drop} → aggregate into ONE incident if count ≥ threshold (env `ACP_WAF_BLOCK_THRESHOLD`, default 1): `key = "cf-waf:" + <window>`, severity "medium", title `"WAF blocked N requests"`.
    - **Sensitive audit actions:** records with an `ActionType`/`action` containing `delete`/`token`/`role` → one incident each, `key = "cf-audit:" + record id`, severity "high".
    (Keep the field-name matching tolerant — Cloudflare datasets vary; match common keys.)
  - `key` is the dedup key (deterministic → idempotent incident id).
- [ ] **Step 3 — test:** an NDJSON sample with 3 `Action:"block"` lines + 1 benign → one WAF incident (count 3); an audit line with `delete` → a high incident; malformed line ignored. `DATABASE_URL=… pnpm test -- cloudflare` + tsc. Commit `feat(app): Cloudflare Logpush parse + incident detection (#55)`.

## Task 1: ingest route → incidents → Tasks

**Files:** Create `services/app/src/http/ingest-routes.ts`, `ingest-routes.test.ts`; Modify `src/server.ts`; reuse the task insert + `incidents`
- [ ] **Step 1:** `registerIngestRoutes(app, d: { db, sql })`: `POST /ingest/cloudflare/:orgId` —
  - **Auth:** require header `x-acp-ingest-secret` === `process.env.ACP_INGEST_SECRET` (401 if mismatch/unset). (This is machine-to-machine; NOT the user session.) The org is the path param (validate it exists → 404).
  - **Body cap:** register this route with a higher bodyLimit or check `Content-Length`; cap at e.g. 5 MiB (reject 413 over). Read the raw NDJSON body (set a text/content-type parser or read `req.body` as string).
  - Parse → `detectIncidents` → for each incident: insert into `incidents` with deterministic id `${orgId}:${key}` (`onConflictDoNothing` → idempotent) AND create a Task (id `incident:${orgId}:${key}`) in the org's security thread (resolve or accept a configured `INCIDENT_THREAD_ID` env / a `#security` channel's default thread — for MVP, accept an optional `?threadId=` or fall back to skipping task creation if none, but still record the incident); link `incidents.taskId`. `notify` the thread.
  - Return `{ incidents: <new count>, tasks: <new count> }`.
  - Register in `server.ts`.
- [ ] **Step 2 — test** (`app.inject`, set `ACP_INGEST_SECRET` via `process.env`): POST NDJSON with the right secret + a seeded org + threadId → `{incidents:>=1, tasks:>=1}`, an `incidents` row + a Task created; **re-POST the same batch → 0 new** (idempotent); wrong/missing secret → 401; unknown org → 404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): POST /ingest/cloudflare (secret-guarded → incidents → Tasks) (#55)`.

## Task 2: document the live Logpush wiring

**Files:** `DEPLOY.md` (append a section) or Create `docs/integrations/cloudflare-logpush.md`
- [ ] Document the post-deploy step: create the Cloudflare Logpush job(s) (account + zone datasets: HTTP Requests, Firewall Events, Audit Logs) pointing at `https://<deploy>/ingest/cloudflare/<orgId>` with the `x-acp-ingest-secret` header, using `CLOUDFLARE_API_TOKEN` (the token you provided, scoped Account·Logs·Edit + Zone·Logs·Edit on ipop.ai/teachr.live). Include the `cloudflare-go`/API call or the dashboard steps + the destination config (HTTP destination, header). Note `ACP_INGEST_SECRET` is set as a Fly/deploy secret. Commit `docs(integrations): Cloudflare Logpush live-wiring (#55)`.

---

## Self-Review
- Delivers #55's buildable core: secret-guarded, size-capped, org-scoped Logpush ingestion → detection → incidents → Tasks, idempotent. The live Logpush job (token + public URL) is documented for post-deploy.
- Backward-compat: additive table/module/route/docs; ingest auth is a machine secret (separate from the user session / #37 fail-closed). Org-scoped. Existing suites green.
- Note: richer detection (anomaly/baseline), generic any-format ingestion (#95), and the autonomous alerter (#93) build on this; this is the Cloudflare-specific MVP that replaces the parked Flarehawk (#54).

## Definition of Done (55)
app suite green; tsc; migration applies. `POST /ingest/cloudflare/:orgId` (secret-guarded) parses Logpush NDJSON, detects WAF/audit incidents, records them + opens Tasks idempotently, org-scoped; wrong secret → 401, unknown org → 404. Live Logpush wiring documented.
