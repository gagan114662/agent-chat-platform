# Plan 58 — User automations: schedules + triggers (#98)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** Luo-style user-facing automations — "every weekday post a brief", "when a run fails, dispatch a fix". An `Automation` = a **trigger** (schedule cron OR event) → an **action** (start an agent run / post a message). Schedule automations fire from the self-prompting tick (#67); event automations fire from the fusion event sink. Org-scoped, RBAC-gated, budget-bounded. Distinct from #67 (the system's internal loop) — this exposes scheduling/triggers to users.

**Branch** `plan-58-automations` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: automations model + engine

**Files:** `services/app/src/db/schema.ts` + next migration (`0026_automations.sql`), Create `src/autonomy/automations.ts`, `automations.test.ts`
- [ ] **Step 1 — schema/migration:** `automations` table: `id` (pk), `orgId`, `name`, `trigger` (jsonb — `{type:"schedule", everyMinutes:number}` or `{type:"event", event:string}` e.g. `outcome:checks_failed`), `action` (jsonb — `{type:"message", threadId, body}` or `{type:"run", threadId, agentId, intent}`), `enabled` (boolean default true), `lastFiredAt` (nullable), `createdById`, `createdAt`. `pnpm db:migrate`.
- [ ] **Step 2 — `automations.ts`:**
  - `createAutomation`/`listAutomations`/`setEnabled`/`deleteAutomation` (org-scoped).
  - `runDueScheduleAutomations(db, deps, { orgId, now })` — enabled schedule automations whose `lastFiredAt` is older than `everyMinutes` (or null) → execute their action (post a message via createMessage+notify, OR start a run via startFusionRun resolving thread→repo+token); update `lastFiredAt`. Bounded by a max-per-tick. Returns fired count.
  - `fireEventAutomations(db, deps, { orgId, event })` — enabled event automations matching `trigger.event` → execute the action. (Called from the sink on outcomes.)
  - `executeAction(db, deps, orgId, action)` — shared dispatch (message or run), guarded (skip run if no repo/token), idempotent-ish.
- [ ] **Step 3 — test (fake temporal):** a schedule automation (everyMinutes 60, lastFiredAt null) with a `message` action → `runDueScheduleAutomations` fires it (message posted, lastFiredAt set); calling again immediately → 0 (not due); an event automation for `outcome:checks_failed` with a `run` action → `fireEventAutomations` starts a run (fake starter called); disabled automation → never fires; org-scoped. `DATABASE_URL=… pnpm test -- automations` + tsc. Commit `feat(app): user automations — schedule + event engine (#98)`.

## Task 1: routes + wire into tick & sink

**Files:** Create `services/app/src/http/automation-routes.ts`, `automation-routes.test.ts`; Modify `src/autonomy/tick.ts` (#67), `src/fusion/events.ts` (sink), `src/server.ts`
- [ ] **Step 1 — routes:** `POST /automations { name, trigger, action }` (admin/`team:manage`), `GET /automations`, `PATCH /automations/:id { enabled }`, `DELETE /automations/:id`. Org-scoped (404). Validate `trigger.type`/`action.type`. Register in `server.ts`.
- [ ] **Step 2 — wire:** in `tick` (#67) call `runDueScheduleAutomations` (so schedules fire on the loop) — add the fired count to `TickResult`. In the sink (`events.ts`), on an `outcome` event call `fireEventAutomations(..., event: "outcome:"+e.outcome)` (best-effort, guarded so a failure doesn't break the sink).
- [ ] **Step 3 — test:** route CRUD (admin 201 / non-admin 403 / cross-org 404); the tick fires a due schedule automation; an outcome event fires a matching event automation (extend tick/events tests with a fake). `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): automation routes + tick/sink wiring (#98)`.

---

## Self-Review
- Delivers #98: user-defined automations (schedule + event triggers → message/run actions), fired by the #67 tick (schedules) and the fusion sink (events), org-scoped, RBAC-gated, bounded. Exposes scheduling/triggers to users vs the internal loop.
- Backward-compat: additive table/module/routes; the tick gains a bounded automation pass; the sink event hook is best-effort/guarded (can't break message delivery); org-scoped (#14). Migration additive. Existing suites green.
- Note: a real Temporal Schedule per org (vs tick-driven) + richer triggers/conditions + a builder UI are follow-ups; this delivers the automation engine.

## Definition of Done (98)
app suite green; tsc; migration applies. Automations CRUD (admin); a due schedule automation fires from the tick (posts/dispatches its action, respects everyMinutes); an outcome event fires a matching event automation; disabled never fires; org-scoped (403/404).
