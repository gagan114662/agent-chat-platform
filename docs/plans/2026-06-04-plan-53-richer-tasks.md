# Plan 53 — Richer task model (#81)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** reload.chat parity — tasks gain **priority (5 levels)**, **due dates**, **richer statuses**, **bulk create (≤50)**, **comments**, and **relations (blocks/related/duplicate)**. Additive to the existing `tasks` table + two new tables, org-scoped, with status-transition validation kept permissive (any → any except out of terminal). Edit-conflict resolution is a noted follow-up.

**Branch** `plan-53-richer-tasks` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: schema + task module

**Files:** `services/app/src/db/schema.ts` + next migration (`0021_richer_tasks.sql`), `src/tasks/tasks.ts` (+ a `task-extra.ts` if cleaner), `tasks.test.ts`
- [ ] **Step 1 — schema/migration:** add to `tasks`: `priority` (text, default `"none"` — one of `none|low|medium|high|urgent`), `dueDate` (timestamptz nullable). New tables: `task_comments` (id, orgId, taskId, authorKind, authorId, body, createdAt) and `task_relations` (id, orgId, fromTaskId, toTaskId, relation text `blocks|related|duplicate`, createdAt; unique (orgId,fromTaskId,toTaskId,relation)). `pnpm db:migrate`.
- [ ] **Step 2 — module:**
  - A `TASK_STATES` const: `["backlog","todo","in_progress","in_review","blocked","done","cancelled"]` (≥8 incl. existing `open` — keep `open` as an alias/valid value for backward-compat). `updateTask(db, { orgId, taskId, priority?, dueDate?, state? })` — org-scoped, validates `priority` ∈ levels + `state` ∈ TASK_STATES (reject invalid → throw); partial update.
  - `addTaskComment(db, { orgId, taskId, authorKind, authorId, body })` (org-scoped, task must exist) + `listTaskComments(db, orgId, taskId)`.
  - `addTaskRelation(db, { orgId, fromTaskId, toTaskId, relation })` (both tasks in org; idempotent via the unique index) + `listTaskRelations(db, orgId, taskId)` (relations where the task is from or to).
  - `bulkCreateTasks(db, { orgId, threadId, items, byKind, byId })` — items ≤ 50 (reject over), one transaction, returns created ids.
- [ ] **Step 3 — test:** `updateTask` sets priority/due/state (invalid state/priority → throws); `addTaskComment`+`listTaskComments`; `addTaskRelation` idempotent + cross-task; `bulkCreateTasks` of 3 → 3 tasks, 51 → throws; all org-scoped (org-B isolated). `DATABASE_URL=… pnpm test -- tasks` + tsc. Commit `feat(app): richer tasks — priority/due/status + comments + relations + bulk (#81)`.

## Task 1: routes

**Files:** `services/app/src/http/task-routes.ts` (extend) or Create `src/http/task-detail-routes.ts`, test; Modify `src/server.ts`
- [ ] `PATCH /tasks/:id { priority?, dueDate?, state? }` → `updateTask` (org-scoped 404). `POST /tasks/:id/comments { body }` → `addTaskComment` (author = actor). `GET /tasks/:id` → the task + its comments + relations. `POST /tasks/:id/relations { toTaskId, relation }` → `addTaskRelation`. `POST /tasks/bulk { threadId, items: [{title, priority?, dueDate?}] }` → `bulkCreateTasks` (≤50, 400 over). Register in `server.ts`.
- [ ] **test** (`app.inject`): PATCH updates a task (invalid state → 400); add a comment then GET shows it; add a relation; bulk-create 3 → 3 ids; 51 → 400; cross-org task → 404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): task detail/update/comment/relation/bulk routes (#81)`.

---

## Self-Review
- Delivers #81: priority + due dates + a richer status set + bulk create (≤50) + task comments + task relations (blocks/related/duplicate), org-scoped, validated.
- Backward-compat: new task columns are nullable/defaulted (`priority="none"`); `open` stays a valid state; existing task create/transition paths unaffected (they don't set the new fields); additive tables/routes. Migration additive. Existing suites green.
- Note: edit-conflict resolution (optimistic concurrency) + a board UI + auto-block-comments are follow-ups (the board UI ties to the frontend-parity epic #102).

## Definition of Done (81)
app suite green; tsc; migration applies. Tasks support priority/due/status (validated), bulk create (≤50, over→400), comments, and relations; `GET /tasks/:id` returns the task with comments+relations; org-scoped (cross-org 404).
