# Plan 32 — Self-prompting loop MVP: Goals + observe→decide→act tick (#67)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** the platform should prompt *itself*, not wait for a human per action (#67). MVP of the closed loop: a **Goal** (stated once by a human) is **decomposed** into Tasks by an injectable planner, and a **tick** (observe→decide→act) scans org state and **dispatches the next actions itself** — start runs for ready tasks — bounded by a **per-tick budget** and the existing **autonomy dial** + org-scoping (autonomous ≠ unsafe). The human supervises (the gates from #16/#20/#21 still apply). Reflection is already covered: run outcomes are captured to memory (#26) and consolidated by dreaming (#40). The production trigger is a Temporal cron; tests use a manual route. LLM-backed planning is injectable (deterministic default for tests).

**Branch** `plan-32-self-prompting-loop` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: Goal object + decomposition

**Files:** `services/app/src/db/schema.ts` + next contiguous migration (e.g. `0011_goals.sql`), Create `src/autonomy/goals.ts`, `goals.test.ts`
- [ ] **Step 1 — schema:** `goals` table: `id` (pk), `orgId`, `title`, `criteria` (text, done-criteria), `state` (text default `"open"` — open|active|done), `createdByKind`, `createdById`. Migration adds it (run `pnpm db:migrate`).
- [ ] **Step 2 — `goals.ts`:**
```ts
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { goals, tasks } from "../db/schema.js";
import { openTaskForMention } from "../tasks/tasks.js";

export interface NewGoal { orgId: string; title: string; criteria?: string; byKind: string; byId: string; }
export async function createGoal(db: DB, g: NewGoal) {
  const [row] = await db.insert(goals).values({
    id: randomUUID(), orgId: g.orgId, title: g.title, criteria: g.criteria ?? "", state: "open",
    createdByKind: g.byKind, createdById: g.byId,
  }).returning();
  return row;
}

export interface Subtask { title: string; }
export type GoalPlanner = (goal: { title: string; criteria: string }) => Subtask[];
// Deterministic default: one task per non-empty line of criteria, else the title.
export const defaultGoalPlanner: GoalPlanner = (goal) => {
  const lines = goal.criteria.split("\n").map((l) => l.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean);
  return (lines.length ? lines : [goal.title]).map((title) => ({ title }));
};

// decomposeGoal: turn an open goal into Tasks (org-scoped), mark it active. Idempotent:
// a goal already 'active'/'done' is skipped. Returns the created task ids.
export async function decomposeGoal(
  db: DB, args: { orgId: string; goalId: string; threadId: string; planner?: GoalPlanner },
): Promise<string[]> {
  const [g] = await db.select().from(goals).where(and(eq(goals.id, args.goalId), eq(goals.orgId, args.orgId)));
  if (!g || g.state !== "open") return [];
  const subs = (args.planner ?? defaultGoalPlanner)({ title: g.title, criteria: g.criteria });
  const ids: string[] = [];
  for (const s of subs) {
    // reuse the task creator (a task needs a thread; the goal carries one)
    const [t] = await db.insert(tasks).values({
      id: randomUUID(), orgId: args.orgId, threadId: args.threadId, title: s.title,
      state: "open", createdByKind: "agent", createdById: "planner",
    }).returning({ id: tasks.id });
    ids.push(t.id);
  }
  await db.update(goals).set({ state: "active" }).where(and(eq(goals.id, g.id), eq(goals.orgId, args.orgId)));
  return ids;
}
```
- [ ] **Step 3 — test:** `createGoal` then `decomposeGoal` with criteria of 3 lines → 3 tasks (org-scoped), goal→active; a second `decomposeGoal` → `[]` (idempotent, not open). Cross-org goalId → `[]`. `DATABASE_URL=… pnpm test -- goals` + tsc. Commit `feat(app): Goal object + decomposition (#67)`.

## Task 1: the tick (observe → decide → act, budgeted)

**Files:** Create `services/app/src/autonomy/tick.ts`, `tick.test.ts`
- [ ] **Step 1 — `tick.ts`:**
```ts
import { and, eq, inArray } from "drizzle-orm";
import type { Client } from "@temporalio/client";
import type postgres from "postgres";
import type { DB } from "../db/client.js";
import { tasks, threads, repos, runs } from "../db/schema.js";
import { startFusionRun } from "../fusion/start.js";

export interface TickDeps { db: DB; sql: postgres.Sql; temporal: Client; sandboxUrl: string; }
export interface TickResult { dispatched: string[]; skipped: number; reason: string; }

// One self-prompting iteration for an org: find OPEN tasks that are ready to run
// (assigned to an agent, thread has a repo with a resolvable token, NOT monitor-only,
// and no active run yet) and dispatch fusion runs for them — bounded by budgetMax.
// Observe → decide → act. The merge/risk/approval gates still apply downstream.
export async function tick(d: TickDeps, args: { orgId: string; budgetMax?: number }): Promise<TickResult> {
  const budget = args.budgetMax ?? 5;
  const open = await d.db.select().from(tasks).where(and(eq(tasks.orgId, args.orgId), eq(tasks.state, "open")));
  const dispatched: string[] = [];
  let skipped = 0;
  for (const t of open) {
    if (dispatched.length >= budget) { skipped++; continue; }
    if (t.assigneeKind !== "agent" || !t.assigneeId) { skipped++; continue; }
    const [thread] = await d.db.select().from(threads).where(and(eq(threads.id, t.threadId), eq(threads.orgId, args.orgId)));
    if (!thread?.repoId) { skipped++; continue; }
    const [repo] = await d.db.select().from(repos).where(and(eq(repos.id, thread.repoId), eq(repos.orgId, args.orgId)));
    if (!repo) { skipped++; continue; }
    if ((repo.autonomy as string) === "monitor-only") { skipped++; continue; } // human-driven dial
    if (!process.env[repo.tokenEnvVar]) { skipped++; continue; }
    // no active (pending/running) run for this task already
    const existing = await d.db.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.orgId, args.orgId), eq(runs.taskId, t.id), inArray(runs.state, ["pending", "running", "awaiting_plan_approval"])));
    if (existing.length > 0) { skipped++; continue; }
    // ACT: open a run for the task + start fusion. Reuse the task→run + starter.
    const runId = `run-${t.id}-${dispatched.length}`;
    await d.db.insert(runs).values({ id: runId, orgId: args.orgId, taskId: t.id, state: "pending", workflowId: `wf-${runId}` });
    await d.db.update(tasks).set({ state: "in_progress" }).where(and(eq(tasks.id, t.id), eq(tasks.orgId, args.orgId)));
    await startFusionRun(d.temporal, {
      run: { id: runId, workflowId: `wf-${runId}` }, orgId: args.orgId, threadId: t.threadId,
      repo: { githubOwner: repo.githubOwner, githubName: repo.githubName, defaultBranch: repo.defaultBranch, tokenEnvVar: repo.tokenEnvVar, autonomy: repo.autonomy },
      agentId: t.assigneeId, intent: t.title, sandboxUrl: d.sandboxUrl,
    });
    dispatched.push(runId);
  }
  return { dispatched, skipped, reason: `budget ${budget}, ${open.length} open tasks` };
}
```
  (Match the real `repos` column names — read `schema.ts`/`start.ts` first; adjust field names like `githubOwner`/`githubName`/`defaultBranch` to whatever the schema uses.)
- [ ] **Step 2 — test (`tick.test.ts`, fake temporal):** seed org-A with 3 open tasks assigned to an agent, threads→repo (autonomy `autopilot-merge`, tokenEnvVar set via `process.env`); `tick(d,{orgId:"o1",budgetMax:2})` → `dispatched.length===2` (budget cap), 2 tasks now `in_progress` with a pending run, the fake `startFusionRun` called twice. A `monitor-only` repo task → skipped. A task with an existing running run → skipped. Cross-org tasks untouched. Commit `feat(app): self-prompting tick — observe ready tasks, dispatch within budget (#67)`.

## Task 2: routes + Temporal cron trigger

**Files:** Create `services/app/src/http/autonomy-routes.ts`, `autonomy-routes.test.ts`, Modify `src/server.ts`; `src/fusion/worker.ts` or a schedule registrar (cron note)
- [ ] **Step 1 — routes:** `registerAutonomyRoutes(app, d: { db, sql, temporal, sandboxUrl })`:
  - `POST /goals { title, criteria? }` → `createGoal(db, {orgId, byKind:"human", byId:userId, ...})`; returns the goal. (Org-scoped via `actor`.)
  - `POST /goals/:id/decompose { threadId }` → `decomposeGoal(...)`; returns created task ids.
  - `POST /orgs/:orgId/tick { budgetMax? }` → guard `actor(req).orgId === :orgId` (403 otherwise); `tick(d, {orgId, budgetMax})`; returns the result. (This is the manual self-prompt trigger.)
  - Register in `server.ts`.
- [ ] **Step 2 — cron note:** add (or document in the worker) a Temporal **schedule** that calls a `tickActivity` per active org on an interval (e.g. every 5 min) — the production self-prompt. If wiring a live schedule is heavy, add a `runTickForAllOrgs(d)` helper + a clear comment/TODO referencing the schedule, and cover `runTickForAllOrgs` with a test (it calls `tick` per org). Keep the loop bounded (budget per tick).
- [ ] **Step 3 — test (`autonomy-routes.test.ts`):** `POST /goals` creates a goal (org-scoped); `POST /goals/:id/decompose` creates tasks; `POST /orgs/o1/tick` dispatches ready tasks (fake temporal) and returns the report; cross-org tick (`POST /orgs/o2/tick` as org-A actor) → 403. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): goal/tick routes + cron-driven self-prompt (#67)`.

---

## Self-Review
- Delivers the #67 MVP: state a Goal once → it decomposes into Tasks → the tick autonomously dispatches runs for ready tasks, **budget-bounded**, **autonomy-dial-respecting**, org-scoped — the system prompting itself. The downstream merge/risk/plan/approval gates (#16/#20/#21) and the now-real feedback loop (#66) still govern what actually lands. Reflection = existing memory capture (#26) + dreaming (#40).
- Backward-compat: all additive (new tables/modules/routes); the tick only acts on agent-assigned, repo-backed, non-monitor-only, token-present tasks with no active run — so it can't double-dispatch or touch human-driven repos. Budget caps runaway; org-scoped. Existing suites green.
- Note: LLM-backed goal decomposition + a richer planner (read state → arbitrary next actions beyond "start ready tasks", e.g. auto-fix red CI, nudge stale approvals) are follow-ups on this loop; the injectable planner + the tick skeleton are the foundation. The live Temporal schedule per org is the production trigger.

## Definition of Done (67)
app suite green + tsc; migration applies. A Goal decomposes into Tasks; `POST /orgs/:orgId/tick` autonomously dispatches fusion runs for ready tasks within a budget, respecting the autonomy dial and org scope; cross-org tick denied. The self-prompting loop runs without a human prompting each action.
