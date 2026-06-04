# Plan 45 — Concurrent sessions per task + parallel-run UI (#64)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** conductor 0.17 — one Task, many concurrent Runs (competing approaches), then compare + pick a winner. The data model is already Task→many-Runs and each Run is an independent Temporal workflow (concurrent for free). Add: **fan-out** (`POST /tasks/:id/fan-out` → start N runs for the same task/intent across agents), a **select-winner** action (`POST /runs/:id/select` → mark the chosen run, migration adds `runs.selected`), `GET /tasks/:id/runs` (list siblings), and a web compare/select surface.

**Branch** `plan-45-concurrent-runs` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: fan-out + sibling runs

**Files:** `services/app/src/db/schema.ts` + next migration (`0016_run_selected.sql`), `src/tasks/tasks.ts` (fanOut helper), Create `src/http/fanout-routes.ts`, `fanout-routes.test.ts`; Modify `src/server.ts`
- [ ] **Step 1 — schema/migration:** add `selected: boolean("selected").notNull().default(false)` to `runs`. Migration `0016_run_selected.sql` (next contiguous — confirm in `services/app/migrations`). `pnpm db:migrate`.
- [ ] **Step 2 — `tasks.ts` `fanOutTask(db, { orgId, taskId, agentIds, threadId, repo, sandboxUrl, temporal })`:** for each agentId (org-scoped, dedup), insert a pending Run for the task + `startFusionRun(...)` (intent = task title; each its own `agent/<runId>` branch). Return the created run ids. (Reuse the reassign run-insert + starter.)
- [ ] **Step 3 — `fanout-routes.ts`:** `POST /tasks/:id/fan-out { agentIds: string[] }` → `actor(req).orgId`; task org-scoped (404); resolve thread→repo + token (guard start if absent, like reassign); `fanOutTask(...)`; post a "🌿 fanned out to N agents" message; return `{ runs }`. `GET /tasks/:id/runs` → list the task's runs (org-scoped) with `{id, state, prNumber, prUrl, selected, assigneeId}`. Register in `server.ts`.
- [ ] **Step 4 — test** (`app.inject`, fake temporal): seed org-A task + 2 agents + thread/repo(token); `POST …/fan-out {agentIds:[a1,a2]}` → 2 runs created (starter called twice), "fanned out" message; `GET …/runs` lists them; cross-org task → 404; unknown agent skipped. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): fan-out a task to N concurrent runs + sibling list (#64)`.

## Task 1: select a winning run

**Files:** Create `services/app/src/http/select-routes.ts` (or add to fanout-routes), `select-routes.test.ts`
- [ ] `POST /runs/:id/select` → org-scoped run (404); set `runs.selected = true` for this run AND `false` for its sibling runs (same taskId, org) — atomically (a single task's runs); post a "✅ selected this run" system message + notify. Return the updated run. Test: 2 sibling runs; select run B → B.selected true, A false; selecting again is idempotent; cross-org → 404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): select a winning run among siblings (#64)`.

## Task 2: web — fan-out + compare/select

**Files:** `services/web/src/api.ts`, `src/components/PrCard.tsx`, `PrCard.test.tsx` (+ a small sibling list if cheap)
- [ ] **Step 1 — `api.ts`:** `fanOutTask(taskId, agentIds)`, `taskRuns(taskId)`, `selectRun(runId)`.
- [ ] **Step 2 — `PrCard.tsx`:** when `metadata.runId` present, add a **"Select"** button (calls injected `onSelectRun(runId)`) and, if the run is `selected`, a "✓ selected" badge (read from metadata if the sink includes it, else just the action). Keep existing buttons. (A full side-by-side compare view is a follow-up; the per-card Select + the `GET /tasks/:id/runs` data are the core.)
- [ ] **Step 3 — test:** `PrCard.test.tsx` — with a runId, a Select button appears and clicking calls `onSelectRun("run1")`. `cd services/web && pnpm test && pnpm build`. Commit `feat(web): select-run action on the PR card (#64)`.

---

## Self-Review
- Delivers #64: fan a task out to N concurrent agent runs (independent Temporal workflows = real parallelism), list siblings, and select a winner (exclusive flag among a task's runs), org-scoped, with an in-thread message + a PR-card Select.
- Backward-compat: `selected` defaults false; additive routes/UI; reuses the reassign/start pattern; org-scoped (#14). Existing suites green.
- Note: a rich side-by-side diff comparison of competing runs + auto-cancelling losers is a follow-up; this delivers fan-out + sibling listing + winner selection.

## Definition of Done (64)
app + web suites green; tsc/build; migration applies. `POST /tasks/:id/fan-out` starts N concurrent runs for one task; `GET /tasks/:id/runs` lists siblings; `POST /runs/:id/select` marks the winner (exclusive among siblings); PR card has Select. Org-scoped.
