# Plan 47 — Autonomous alerts (#93)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** Sazabi "monitoring is dead" — proactive, contextual alerts, no manual thresholds. A detector scans the org's run/CI state and emits **alerts** (recorded as `incidents`, source `alert`, reusing the #55 table — idempotent) with impact + a recommended action, posted into a channel. Wired into the self-prompting tick (#67) so it runs on the loop; also exposed via a manual scan route. Each alert that references a failing run links it so the existing fix/approve paths can act ("dispatch a fix").

**Branch** `plan-47-autonomous-alerts` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: alert detectors

**Files:** Create `services/app/src/autonomy/alerts.ts`, `alerts.test.ts`; reuse `incidents` (#55) + `runs`/`run_events`
- [ ] **Step 1 — `alerts.ts` `detectAlerts(db, orgId): Promise<Alert[]>`** (`Alert = { key; severity; title; body; runId? }`):
  - **Failed runs:** runs in `checks_failed`/`error`/`timeout` (recent) → one alert each, `key = "run-failed:"+runId`, severity "high", title `Run <id> <state>`, body with the PR (if any) + "recommended: dispatch a fix / review".
  - **Repeated CI failures:** ≥ N `ci_fix_attempt` run_events for a run → `key = "ci-stuck:"+runId`, severity "high", "CI failing after N fix attempts — needs human".
  - **Aging held runs:** runs `held_for_human` older than a threshold → `key = "held-aging:"+runId`, severity "medium", "held for review, awaiting approval".
  (Tunable thresholds via env with sane defaults; keep queries org-scoped.)
- [ ] **Step 2 — `recordAlerts(db, sql, { orgId, threadId? }, alerts)`:** for each alert, insert an `incidents` row (source `"alert"`, deterministic id `${orgId}:${key}` + `onConflictDoNothing` → idempotent) and, if a `threadId` is configured (env `ALERT_THREAD_ID` or passed), post a system message + notify. Return the count of NEW alerts.
- [ ] **Step 3 — test:** seed a `checks_failed` run + a `held_for_human` run (aged) → `detectAlerts` returns the matching alerts; `recordAlerts` inserts incidents idempotently (2nd call → 0 new); org-scoped (org-B runs excluded). `DATABASE_URL=… pnpm test -- alerts` + tsc. Commit `feat(app): autonomous alert detectors + recording (#93)`.

## Task 1: scan route + wire into the tick

**Files:** `services/app/src/http/autonomy-routes.ts` (add a route), `services/app/src/autonomy/tick.ts` (call detect+record), `autonomy-routes.test.ts`, `tick.test.ts`
- [ ] **Step 1:** add `POST /orgs/:orgId/alerts/scan` → guard `actor(req).orgId === :orgId` (403); `detectAlerts` + `recordAlerts`; return `{ alerts: <new count> }`. `GET /orgs/:orgId/alerts` → list recent `incidents` where source=`alert` (org-scoped).
- [ ] **Step 2 — tick:** in `tick(...)` (#67), after the dispatch pass, run `detectAlerts` + `recordAlerts` (bounded) so the self-prompting loop surfaces alerts each iteration. Add to the `TickResult` (`alerts: <count>`).
- [ ] **Step 3 — test:** route scan returns the alert count + GET lists them; cross-org scan → 403; `tick` now also records alerts (extend the tick test: a failed run in the org → tick reports `alerts >= 1`). `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): alert scan route + alerts in the self-prompting tick (#93)`.

---

## Self-Review
- Delivers #93: proactive detectors (failed runs, CI-stuck, aging-held) → idempotent alert incidents + channel posts, no manual thresholds, surfaced both on-demand and via the #67 tick. Each alert references the run so the existing fix/approve flows ("dispatch a fix") apply.
- Backward-compat: reuses the #55 `incidents` table (no migration); additive route + tick extension; idempotent (deterministic ids); org-scoped (#14). Existing suites green.
- Note: richer anomaly/baseline detection + an in-app one-click "dispatch fix from alert" button + dedup/snooze are follow-ups; this delivers the detector→alert→record loop. Pairs with conversational debugging (#92) + root-cause (#94).

## Definition of Done (93)
app suite green; tsc. `detectAlerts` finds failed/stuck/aging runs; `recordAlerts` records them as idempotent alert-incidents + posts; `POST /orgs/:orgId/alerts/scan` (org-guarded) + the #67 tick both run it; `GET …/alerts` lists them. Org-scoped.
