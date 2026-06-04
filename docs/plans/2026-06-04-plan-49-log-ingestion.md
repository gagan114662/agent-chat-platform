# Plan 49 — Generic log/telemetry ingestion (#95)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** Sazabi "logs are all you need" — ingest logs from **any source, any format** into a unified store, derive incidents, and make them queryable (feeds conversational debug #92 + alerts #93). Generalizes the Cloudflare-specific #55: a secret-guarded `POST /ingest/logs/:source/:orgId` accepts NDJSON / JSON-array / plain text, normalizes each record to a `log_events` row (level + message + raw), detects error-level lines → `incidents` (reuse #55 table, idempotent), all org-scoped + size-capped. The debug router (#92) gains a "recent errors / logs" query over the store.

**Branch** `plan-49-log-ingestion` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: log_events store + generic parser + detection

**Files:** `services/app/src/db/schema.ts` + next migration (`0017_log_events.sql` — confirm next contiguous), Create `src/observability/logs.ts`, `logs.test.ts`
- [ ] **Step 1 — schema/migration:** `log_events` table: `id` (pk), `orgId`, `source`, `level` (text), `message` (text), `raw` (jsonb), `ts` (timestamptz default now). Index on (`orgId`,`ts`). `pnpm db:migrate`.
- [ ] **Step 2 — `logs.ts`:**
  - `parseLogs(body: string, contentType?: string): { level: string; message: string; raw: unknown }[]` — NDJSON (one JSON/line), JSON array, or plain text lines; per record extract `level` (from a `level`/`severity`/`lvl` field, else infer: line contains `ERROR`/`FATAL`/`WARN` → that, else `info`) + `message` (a `message`/`msg`/`text` field, else the raw line). Skip blank/malformed-but-unparseable lines gracefully.
  - `errorIncidents(records): { key; severity; title; body }[]` — group error/fatal records into incidents (e.g. one incident per distinct message prefix, severity high/medium), `key = "log-err:"+hash(messagePrefix)`.
- [ ] **Step 3 — test:** NDJSON with `{level:"error",message:"db down"}` + a `WARN` text line + a malformed line → 2 parsed records (malformed skipped), error record → 1 incident; plain-text "ERROR boom" line → level error. `DATABASE_URL=… pnpm test -- logs` + tsc. Commit `feat(app): generic log parser + error-incident detection + log_events (#95)`.

## Task 1: ingest route + debug query over logs

**Files:** Create `services/app/src/http/log-ingest-routes.ts`, `log-ingest-routes.test.ts`; Modify `src/http/auth-routes.ts` (the `/ingest/*` bypass already exists from #55), `src/observability/debug.ts` (add a logs query), `src/server.ts`
- [ ] **Step 1 — route:** `POST /ingest/logs/:source/:orgId` — same machine-auth as #55 (`x-acp-ingest-secret` === `ACP_INGEST_SECRET`, 401), size cap, org exists (404). Parse with `parseLogs` → insert `log_events` rows (batch) → `errorIncidents` → insert `incidents` (source `log:<source>`, deterministic id, idempotent). Return `{ ingested: <rows>, incidents: <new> }`. Register in `server.ts`. (The `/ingest/*` preHandler bypass from #55 already covers this path — verify.)
- [ ] **Step 2 — debug query (#92):** extend `answerDebug` (`src/observability/debug.ts`) with a "recent errors" / "logs" branch → most recent error-level `log_events` for the org. (Small addition; keep existing branches.)
- [ ] **Step 3 — test:** `log-ingest-routes.test.ts` — POST NDJSON with the secret + seeded org → `{ingested:>=1, incidents:>=1}`, `log_events` rows + an incident; re-POST → incidents idempotent (0 new); wrong secret → 401; unknown org → 404; oversize → 413. A `debug.test.ts` case: after ingesting an error log, "recent errors" returns it (org-scoped). `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): POST /ingest/logs generic ingestion + logs in debug query (#95)`.

---

## Self-Review
- Delivers #95: any-source/any-format log ingestion → a unified `log_events` store + error→incident derivation + queryable via conversational debug (#92) and feeding alerts (#93). The "logs are all you need" substrate; Cloudflare (#55) is now one source among many.
- Backward-compat: additive table/module/route; reuses the #55 ingest-secret auth + `/ingest/*` preHandler bypass + the `incidents` table; idempotent; org-scoped. Existing suites green.
- Note: embeddings/semantic log search + retention/TTL + the ScyllaDB hot-path store (#96) are scaling follow-ups; this delivers the ingestion + relational query MVP.

## Definition of Done (95)
app suite green; tsc; migration applies. `POST /ingest/logs/:source/:orgId` (secret-guarded, size-capped) parses NDJSON/JSON/text → `log_events` + error incidents (idempotent), org-scoped (401/404/413); the debug router answers "recent errors" over the store.
