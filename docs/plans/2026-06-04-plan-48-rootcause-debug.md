# Plan 48 — Root-cause analysis (#94) + conversational debugging (#92)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** Sazabi parity — pinpoint the culprit for a failure (#94) and ask the system in plain language (#92), both over our existing telemetry (run_events, runs, incidents, the PR diff #17, CI failure context #18). **#94:** `GET /runs/:id/root-cause` correlates the failing CI context with the run's changed files → ranked suspects + a summary. **#92:** `POST /debug/query {question}` answers NL questions via a rule-based router over the telemetry (LLM-backed answering is a follow-up; the MVP is honest pattern-matching, no fake LLM). Both org-scoped.

**Branch** `plan-48-rootcause-debug` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: root-cause (#94)

**Files:** Create `services/app/src/observability/root-cause.ts`, `root-cause.test.ts`, `src/http/rootcause-routes.ts`, `rootcause-routes.test.ts`; Modify `src/server.ts`
- [ ] **Step 1 — `root-cause.ts` `rankCulprits(failureContext: string, files: ChangedFile[]): { file: string; reason: string }[]`:** rank the run's changed files by likelihood of causing the failure — a file scores higher if its path/basename (or a symbol in it) appears in `failureContext`, or it's a large/protected-path change. Return ranked suspects with a human reason ("mentioned in CI failure", "largest diff", "touches CI config"). Pure function (no IO) → unit-testable.
- [ ] **Step 2 — route (`rootcause-routes.ts`):** `GET /runs/:id/root-cause` → `actor(req).orgId`; org-scoped run (404); need a commitSha + pr (404 if none); resolve repo + token (400 if missing); `const gh = (d.makeGitHub ?? OctokitGitHubService)(token)`; `files = await gh.getChangedFiles(owner, repo, prNumber)` + `failure = await gh.getCheckFailureContext(owner, repo, run.commitSha)`; return `{ summary: "<state>: <failure>", failure, suspects: rankCulprits(failure, files) }`. Register in `server.ts`.
- [ ] **Step 3 — test:** `root-cause.test.ts` — given a failure string mentioning `auth.ts` + files `[auth.ts (small), README.md (huge)]` → `auth.ts` ranked first ("mentioned in CI failure"). `rootcause-routes.test.ts` (fake makeGitHub): org-A run with pr+sha → 200 with suspects; cross-org → 404; no pr → 404; no token → 400. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): root-cause analysis — rank culprit files for a failure (#94)`.

## Task 1: conversational debugging (#92)

**Files:** Create `services/app/src/observability/debug.ts`, `debug.test.ts`, `src/http/debug-routes.ts`, `debug-routes.test.ts`; Modify `src/server.ts`
- [ ] **Step 1 — `debug.ts` `answerDebug(db, orgId, question): Promise<{ answer: string; kind: string; data: unknown }>`** — a rule-based router over the org's telemetry:
  - matches `run <id>` / "why did run X" → fetch that run (org-scoped) + its `run_events` + outcome → answer summarizing state + last events.
  - "recent failures" / "what's failing" → list recent runs in `checks_failed`/`error`/`timeout` (org-scoped).
  - "error rate" / "how many ... merged|failed" → counts of runs by state.
  - "incidents" / "alerts" → recent `incidents` (org-scoped).
  - fallback → `{ kind:"unknown", answer:"I can answer: a run's status, recent failures, run counts by state, or incidents.", data:null }`.
  (All queries org-scoped. This is deterministic pattern-matching — an LLM answerer is a documented follow-up.)
- [ ] **Step 2 — route (`debug-routes.ts`):** `POST /debug/query { question }` → `actor(req).orgId`; `answerDebug(db, orgId, question)`; return it. Register in `server.ts`.
- [ ] **Step 3 — test:** `debug.test.ts` — seed runs (1 merged, 2 checks_failed) + an incident; "recent failures" → lists the 2; "run counts" → `{merged:1, checks_failed:2}`-ish; "run <id>" → that run's summary; org-scoped (org-B excluded); unknown question → the help fallback. `debug-routes.test.ts` (`app.inject`): a question returns an answer; org-scoped. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): conversational debugging — rule-based telemetry Q&A (#92)`.

---

## Self-Review
- #94: a failed run's culprit files are ranked by correlating the CI failure context with the diff — feeds the agent's fix (ApplyFeedback #66) and the alerts (#93). #92: ask the system in plain language; deterministic router over run_events/runs/incidents, org-scoped.
- Backward-compat: additive modules/routes; reuse existing GitHubService (getChangedFiles/getCheckFailureContext) + DB; org-scoped (#14). No migration. Existing suites green.
- Note: LLM-backed answering + generated charts (#92) and symbol-level blame (#94) are follow-ups; the MVPs are honest, deterministic, and useful now. Generic any-source log ingestion is #95 (separate).

## Definition of Done (94, 92)
app suite green; tsc. `GET /runs/:id/root-cause` returns ranked suspect files for a failure (org-scoped); `POST /debug/query` answers run-status / recent-failures / counts / incidents questions over org telemetry. Cross-org denied.
