# Plan 71 — Fusion run-level retry (idempotent activity) (#70)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** the fusion workflow uses `maximumAttempts: 1` because the activity opens a PR (not idempotent) — so a transient sandbox/GitHub blip kills the run with no retry. Make the side-effecting steps **idempotent**: `openPr` becomes **find-or-create** (reuse an existing PR for the head branch), and `merge` tolerates an already-merged PR. Then bump the workflow to `maximumAttempts: 3` with backoff so transient failures recover.

**Branch** `plan-71-run-retry` (off `main`). Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: idempotent openPr + merge (orchestrator)

**Files:** `services/orchestrator/src/github/{github-service,octokit-github-service,octokit-github-service.test}.ts`, `src/core/run-fusion.ts`, `run-fusion.test.ts`, fakes
- [ ] **Step 1 — `findPrForBranch`:** add `GitHubService.findPrForBranch(owner, repo, head): Promise<{ number: number; url: string } | null>` (Octokit `pulls.list({ owner, repo, head: \`${owner}:${head}\`, state: "open" })` → first match or null). nock test + add to every fake (`vi.fn().mockResolvedValue(null)`).
- [ ] **Step 2 — find-or-create in `runFusion`:** before `openPr`, `const existing = await deps.github.findPrForBranch(owner, repo, run.branch); const pr = existing ?? await deps.github.openPr({...})`. So a retried activity reuses the PR instead of creating a duplicate. (The `pr_opened` event still fires with the resolved number.)
- [ ] **Step 3 — tolerant merge:** wrap `deps.github.merge(...)` so an "already merged"/422 is treated as success (idempotent) — catch the error, if it indicates already-merged, proceed to the `merged` outcome; else rethrow. (A small `mergeIdempotent` helper or a try/catch with a message check.)
- [ ] **Step 4 — test:** with a fake whose `findPrForBranch` returns an existing PR → `runFusion` does NOT call `openPr` and uses the existing number; with `findPrForBranch` null → opens as today; a `merge` that throws "already merged" → outcome `merged` (not error); existing run-fusion tests stay green. `pnpm test` + tsc. Commit `feat(orchestrator): idempotent openPr (find-or-create) + tolerant merge (#70)`.

## Task 1: enable workflow retries (app)

**Files:** `services/app/src/fusion/workflows.ts`, test
- [ ] **Step 1 — retry policy:** change the activity options from `maximumAttempts: 1` to `maximumAttempts: 3` with a `backoffCoefficient`/`initialInterval` (e.g. 2s initial, coefficient 2) — now safe because the activity's side effects (PR create, merge) are idempotent (Task 0). Keep the `startToCloseTimeout` generous. Update the comment (it currently says "NOT idempotent (opens a PR); run-level retry is a later plan" → now retryable).
- [ ] **Step 2 — test:** a unit asserting the workflow's activity proxy is configured with `maximumAttempts: 3` (export the options or assert via the `proxyActivities` config object if testable; if Temporal's test harness isn't runnable here — it needs a network download — assert the exported retry-policy constant instead). `pnpm test` + tsc. Commit `feat(app): fusion workflow run-level retry (maximumAttempts 3, #70)`.

---

## Self-Review
- Closes #70: the fusion activity's side effects are idempotent (find-or-create PR, tolerant merge), so the workflow can retry transient failures (3 attempts, backoff) instead of dying on the first blip.
- Backward-compat: `findPrForBranch` interface addition → update fakes; the find-or-create + tolerant-merge are behavior-preserving on the happy path (no existing PR / clean merge = today); the retry bump only affects failure paths. Existing run-fusion/workflow tests green (the live Temporal integration test is the known no-network skip).
- Note: full activity idempotency for the sandbox push (skip re-running the agent if the branch already has the commit) is a deeper follow-up; this delivers PR/merge idempotency + retries, which covers the common transient-failure case.

## Definition of Done (70)
orchestrator + app suites green; tsc. `openPr` reuses an existing PR for the branch (no duplicates on retry); `merge` tolerates already-merged; the workflow retries up to 3× with backoff. Happy path unchanged.
