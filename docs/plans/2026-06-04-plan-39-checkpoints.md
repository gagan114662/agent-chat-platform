# Plan 39 — Checkpoints: run save/restore (#62)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** conductor 0.19/0.44 — save-points you can roll back to. In our model a run produces commits on a branch, so a **checkpoint = a named snapshot of `{branch, commitSha}`** at a step. The fusion sink records a checkpoint whenever an event carries a `commitSha` (`branch_pushed`, `outcome`). **Restore/rewind** = open a NEW run based on the checkpoint's commit (reuse `startFusionRun` with `baseBranchOverride` = the checkpoint branch, building on the #53 override). List + restore are org-scoped; surfaced on the PR card.

**Branch** `plan-39-checkpoints` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: checkpoints table + capture in the sink

**Files:** `services/app/src/db/schema.ts` + next migration (`0013_run_checkpoints.sql`), Create `src/fusion/checkpoints.ts`, `checkpoints.test.ts`; Modify `src/fusion/events.ts`
- [ ] **Step 1 — schema/migration:** `run_checkpoints` table: `id` (pk), `orgId`, `runId`, `label`, `branch`, `commitSha`, `createdAt` (defaultNow). Migration `0013_run_checkpoints.sql` (next contiguous — confirm by reading `services/app/migrations`). Run `pnpm db:migrate`.
- [ ] **Step 2 — `checkpoints.ts`:** `recordCheckpoint(db, { orgId, runId, label, branch, commitSha })` — deterministic id `${runId}:cp:${commitSha}` + `onConflictDoNothing` (idempotent on replay); `listCheckpoints(db, orgId, runId)` (org-scoped, ordered by createdAt).
- [ ] **Step 3 — sink (`events.ts`):** when handling an event that carries a `commitSha` (`branch_pushed` → label "agent push"; `outcome` → label `outcome:<outcome>`), call `recordCheckpoint(...)` with `ctx.orgId/runId`, the event's `branch ?? run branch`, and `commitSha`. Idempotent (deterministic id), so replays don't dup. (Keep the existing message/notify/transition logic intact.)
- [ ] **Step 4 — test:** seed a run; feed the sink a `branch_pushed` then an `outcome` (both with commitSha) → 2 checkpoints (or 1 if same sha) via `listCheckpoints`; re-feeding the same events → no new checkpoints (idempotent); org-scoped (org-B can't see them). `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): run checkpoints — capture {branch,commit} from fusion events (#62)`.

## Task 1: list + restore routes

**Files:** Create `services/app/src/http/checkpoint-routes.ts`, `checkpoint-routes.test.ts`; Modify `src/server.ts`
- [ ] `registerCheckpointRoutes(app, d: { db, sql, temporal, sandboxUrl })`:
  - `GET /runs/:id/checkpoints` → `actor(req).orgId`; run org-scoped (404); `listCheckpoints`.
  - `POST /runs/:id/checkpoints/:cpId/restore` → org-scoped run + checkpoint (404 if not in org); resolve run→task→thread→repo + token; open a NEW run (pending) for the same task and `startFusionRun(..., { baseBranchOverride: <checkpoint.branch>, intent: <task title + " (restored from "+label+")"> })`; post a `system` message "↩️ restored from checkpoint <label> (<sha7>)" + notify; return `{ run }` (201). (If no repo/token, still record the new run + message, guard the start — like the reassign route.)
  - Register in `server.ts`.
- [ ] **test** (`app.inject`, fake temporal): seed org-A run + a checkpoint (via recordCheckpoint) + task/thread/repo(token); `GET …/checkpoints` → the checkpoint; `POST …/restore` → 201, a new pending run, fake `startFusionRun` got `baseBranchOverride` = the checkpoint branch, a "restored" message posted; cross-org → 404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): checkpoint list + restore routes (#62)`.

## Task 2: web — checkpoints on the PR card

**Files:** `services/web/src/api.ts`, `src/components/PrCard.tsx`, `PrCard.test.tsx`
- [ ] `api.ts`: `listCheckpoints(runId)` + `restoreCheckpoint(runId, cpId)`. `PrCard.tsx`: when `metadata.runId` present, a **"Checkpoints"** toggle that lazy-loads via an injected `onLoadCheckpoints(runId)` and lists them, each with a **"↩ Restore"** button calling `onRestoreCheckpoint(runId, cpId)` (threaded App→…→PrCard; App calls the api then refetch). Keep existing buttons. `PrCard.test.tsx`: with a runId, the Checkpoints toggle loads + lists a checkpoint; Restore calls `onRestoreCheckpoint("run1","cp1")`. `cd services/web && pnpm test && pnpm build`. Commit `feat(web): checkpoints list + restore on the PR card (#62)`.

---

## Self-Review
- Delivers #62: each run's commit snapshots are captured (idempotent, from the event stream), listable, and **restorable** (rewind = a new run based on the checkpoint commit via the #53 base-override), org-scoped, surfaced in-thread.
- Backward-compat: additive table/module/routes/UI; sink capture is idempotent + doesn't disturb existing message/transition logic; org-scoped (#14). Existing suites green.
- Note: this leverages git commits as the durable checkpoint (Temporal gives workflow durability separately); finer-grained mid-run checkpoints (per ci_fix_attempt commit) need the orchestrator to surface each fix sha — a follow-up.

## Definition of Done (62)
app + web suites green; tsc/build; migration applies. A run's checkpoints are captured from its events, listed via `GET /runs/:id/checkpoints`, and restorable via `POST …/restore` (new run from the checkpoint commit); PR card shows them with Restore. Org-scoped.
