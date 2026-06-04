# Plan 17 — Multi-agent task hand-off (#27)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps.

**Design (author's call):** reload's "agents reassign tasks to each other like a team." A task can be **handed off** to another agent: reassign the task's assignee + spin a **new Run** for the new agent (intent = the task title) + start its fusion workflow + post a "🔁 handed off to @agent" message. Org-scoped. The richer tasks UI + agent-authored free-form mentions are follow-ups; this delivers the API primitive (humans OR agents call it) that makes inter-agent coordination real. (Multi-agent multi-mention already works: a message mentioning N agents starts N runs.)

**Branch** `plan-17-task-handoff` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: `reassignTask` (tasks module)

**Files:** `services/app/src/tasks/tasks.ts`, `tasks.test.ts`
- [ ] **Step 1:** add `reassignTask(db, { orgId, taskId, agentId, byKind, byId })`:
  - Load task `WHERE id=:taskId AND org_id=:orgId` (throw "task not found" otherwise). Load agent `WHERE id=:agentId AND org_id=:orgId` (throw "agent not found" — cross-org safe).
  - Update task: `assigneeKind="agent", assigneeId=agentId, state="in_progress"`.
  - Insert a new `Run` (pending) for the task (`workflowId = run-<uuid>`), same shape as `openTaskForMention` (reuse the run-insert).
  - Return `{ task, run }`.
- [ ] **Step 2:** test in `tasks.test.ts`: seed an org-A task (assigned to a1) + agent a2 (org A); `reassignTask` → task.assigneeId="a2", a fresh run (pending) created. Cross-org: reassign with an org-B agent id → throws "agent not found"; reassign a task from another org → throws "task not found". Run `DATABASE_URL=... pnpm test -- tasks` green.
- [ ] **Step 3:** commit `feat(app): reassignTask — hand a task to another agent + new run`.

## Task 1: `POST /tasks/:id/reassign` route (start the new run)

**Files:** Create `services/app/src/http/task-routes.ts`, `task-routes.test.ts`; Modify `src/http/routes.ts` (extract the activity-input builder) + `src/server.ts`

- [ ] **Step 1: extract a shared starter.** In `routes.ts`, the mention handler builds the `RunFusionActivityInput` + calls `startRun`. Extract a helper (e.g. in `src/fusion/start.ts`): `startFusionRun(temporal, { run, thread, repo, agentId, intent, sandboxUrl })` that builds the input (owner/repo/baseBranch/intent/branch:`agent/${run.id}`/tokenEnvVar:`repo.tokenEnvVar`/sandboxUrl/pollMs/maxPolls/autonomy/sink) and calls `startRun`. Use it from BOTH the mention handler (refactor, behavior identical — keep its tests green) and the reassign route.
- [ ] **Step 2: `task-routes.ts`** — `registerTaskRoutes(app, d: { db, sql, temporal, sandboxUrl })`: `POST /tasks/:id/reassign { agentId }`: `const { orgId, userId } = actor(req)`; `reassignTask(db, {orgId, taskId, agentId, byKind:"human", byId:userId})`; resolve the task's thread→repo (org-scoped); if repo+token present, `startFusionRun(...)` for the new run; `createMessage` (agent-authored, kind "system") "🔁 handed off to <agent.displayName>" + `notify`. Return `{ task, run }` (201). 404 if task/agent not in org. Register in `server.ts`.
- [ ] **Step 3: `task-routes.test.ts`** (`app.inject`, no Temporal needed if you guard startFusionRun when no repo — OR inject a fake temporal): seed org-A task+thread(repo r1, tokenEnvVar set)+agent a2; with `E2E_GITHUB_TOKEN` unset the start is skipped but the reassign + message still happen — assert 201, task reassigned to a2, a new run row, a "handed off" message posted. Cross-org reassign → 404. (Keep the GitHub/Temporal calls injectable or guarded so the test needs no live services.)
- [ ] **Step 4:** `DATABASE_URL=... pnpm test` (whole app suite incl. the refactored mention tests still green) + tsc. Commit `feat(app): POST /tasks/:id/reassign (task hand-off) + shared fusion starter`.

---

## Self-Review
- Delivers the #27 hand-off primitive: reassign → new agent run, org-scoped, with a thread message. Multi-mention (N agents → N runs) already works. Agent-authored free-form @mentions + a tasks/board UI are follow-ups.
- Backward-compat: the mention handler is refactored to use the shared `startFusionRun` (behavior identical — its existing tests must stay green); new route/module are additive; org-scoped (reuses #14 pattern). 
- Note: if `temporal`/token aren't available (tests), the reassign still records the hand-off + run; the workflow start is guarded/injected so tests need no live services.

## Definition of Done (17)
App suite green (incl. refactored mention tests) + tsc clean. `POST /tasks/:id/reassign` hands a task to another in-org agent, creates a new run, starts its fusion workflow (when repo+token present), and posts a hand-off message. Cross-org reassign is denied.
