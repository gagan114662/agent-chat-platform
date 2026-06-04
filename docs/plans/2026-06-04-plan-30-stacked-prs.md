# Plan 30 — Stacked PRs core (#53)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** kitlangton/stack + Graphite-style stacked PRs (#53). The buildable, no-infra core: a run can be a **child** of another run and open its PR **based on the parent's branch** instead of the repo default branch — so dependent work stacks. A run gets an optional `parentRunId`; when set, the fusion `baseBranch` = the parent's branch (`agent/<parentRunId>`) and the PR opens against it. The natural producer is task hand-off (#27): handing a task to another agent can stack the new run on the current one. Auto-**repair** after a parent squash-merges (retarget children) needs the `stack` CLI + richer GitHub perms (#23) and is the documented follow-up; this delivers the stack *creation* primitive.

**Branch** `plan-30-stacked-prs` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: `runs.parentRunId` + stacked base resolution

**Files:** `services/app/src/db/schema.ts` + migration `0011_run_parent.sql`, `services/app/src/fusion/start.ts`, `start.test.ts` (or a focused unit)
- [ ] **Step 1 — schema + migration:** add `parentRunId: text("parent_run_id")` (nullable) to the `runs` table. Migration `0011_run_parent.sql`: `ALTER TABLE runs ADD COLUMN parent_run_id text;` (follow the existing migration pattern; run `pnpm db:migrate`).
- [ ] **Step 2 — `StartFusionRunInput`:** add `baseBranchOverride?: string`. In `startFusionRun`, the activity input `baseBranch` becomes `i.baseBranchOverride ?? i.repo.defaultBranch`. (Everything else unchanged.) Add a unit asserting that when `baseBranchOverride` is set, the started activity input uses it (use the existing fake `startRun`/temporal seam from the other start tests).
- [ ] **Step 3:** commit `feat(app): runs.parentRunId + stacked base-branch override (#53)`.

## Task 1: stack a hand-off run on its parent

**Files:** `services/app/src/tasks/tasks.ts` (`reassignTask`), `services/app/src/http/task-routes.ts`, `task-routes.test.ts`
- [ ] **Step 1 — `reassignTask` records the parent:** `reassignTask` already inserts a new pending Run. Add an optional `parentRunId` arg; persist it on the new run row (default null → today's behavior).
- [ ] **Step 2 — task-routes stacking:** `POST /tasks/:id/reassign` gains an optional body field `stackOnRunId?: string`. When present (and that run is in the org), pass `parentRunId: stackOnRunId` to `reassignTask`, resolve the parent run's branch (`agent/${stackOnRunId}`), and call `startFusionRun(..., { baseBranchOverride: \`agent/${stackOnRunId}\` })` so the child PR bases on the parent branch. The "🔁 handed off" message notes it's stacked on the parent. No `stackOnRunId` → unchanged flat behavior.
- [ ] **Step 3 — test:** seed an org-A task + a parent run (id `r-parent`) + agent + thread/repo(token env). `POST /tasks/:id/reassign { agentId, stackOnRunId: "r-parent" }` → new run has `parentRunId="r-parent"`; the fake `startFusionRun` received `baseBranchOverride: "agent/r-parent"`; message mentions stacking. Without `stackOnRunId` → `parentRunId` null + base = default branch. Cross-org parent → ignored/404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): stack a handed-off run on its parent's branch (#53)`.

## Task 2: surface the stack on the PR card

**Files:** `services/web/src/types.ts`, `src/components/PrCard.tsx`, `PrCard.test.tsx`
- [ ] **Step 1:** when a `pr_card`/run carries a `parentRunId` (thread it through the run/message metadata the sink already attaches — add `parentRunId` to the outcome metadata in `events.ts` if not present), render a small **"⬑ stacked on <parent>"** badge on the PR card. Purely informational.
- [ ] **Step 2 — test:** `PrCard.test.tsx` — a card with `metadata.parentRunId` shows the stacked badge; without it, no badge. `cd services/web && pnpm test && pnpm build`. Commit `feat(web): stacked-on badge on the PR card (#53)`.

---

## Self-Review
- Delivers the #53 creation primitive: a hand-off can **stack** the new run's PR on the parent's branch (`parentRunId` + `baseBranchOverride`), shown in-thread. Flat behavior is the default (no `stackOnRunId`).
- Backward-compat: `parentRunId` nullable + `baseBranchOverride` optional → existing fusion/reassign tests unchanged; org-scoped (#14). Migration additive.
- Note: auto-**repair** (retarget/rebase children when a parent squash-merges, `stack sync`) needs the `stack` CLI provisioned in the sandbox (a built-in tool, #48) + richer PR-mutation perms (GitHub App, #23) — documented follow-up. This is the stack *creation* half.

## Definition of Done (53)
app + web suites green + tsc/build. A reassign with `stackOnRunId` creates a child run with `parentRunId` whose PR bases on `agent/<parent>`; the PR card shows a stacked badge; default reassign stays flat. Org-scoped. Migration applies.
