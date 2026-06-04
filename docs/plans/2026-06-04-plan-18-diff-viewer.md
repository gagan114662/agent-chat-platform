# Plan 18 — In-thread diff viewer (#17)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps.

**Design (author's call):** reload/conductor's in-thread code review starts with seeing the diff. The PR card gets a **"View diff"** toggle that fetches the run's PR patch and renders a unified diff (per-file hunks, +/− coloring). Backend: extend `getChangedFiles` to include the GitHub `patch`, + an org-scoped `GET /runs/:id/diff`. Line-level commenting (→ `apply_feedback`) is a follow-up; this delivers the viewer.

**Branch** `plan-18-diff-viewer` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: orchestrator — `getChangedFiles` returns the patch

**Files:** `services/orchestrator/src/policy/risk.ts` (ChangedFile), `src/github/octokit-github-service.ts`, `octokit-github-service.test.ts`
- [ ] Add `patch?: string` to `ChangedFile` (`risk.ts`). In `octokit-github-service.ts` `getChangedFiles`, include `patch: f.patch` in the mapped object (Octokit `pulls.listFiles` returns `patch` per file). Extend the existing nock test: a file with a `patch` string round-trips. (classifyDiff ignores `patch` — unaffected.) `pnpm test` + tsc. Commit `feat(orchestrator): include file patch in getChangedFiles`.

## Task 1: app — `GET /runs/:id/diff`

**Files:** Create `services/app/src/http/diff-routes.ts`, `diff-routes.test.ts`; Modify `src/server.ts`
- [ ] **Step 1:** `registerDiffRoutes(app, d: { db, makeGitHub? })`: `GET /runs/:id/diff` → `actor(req).orgId`; load run `WHERE id AND org_id` (404), resolve run→task→thread→repo (org-scoped); need `pr_number` (404 if none yet); token from `process.env[repo.tokenEnvVar]` (400 if missing); `const gh = (d.makeGitHub ?? ((t)=>new OctokitGitHubService(t)))(token)`; return `await gh.getChangedFiles(repo.githubOwner, repo.githubName, run.prNumber)` (files incl. patch). Register in `server.ts`.
- [ ] **Step 2:** `diff-routes.test.ts` (`app.inject`, inject a fake `makeGitHub` returning files-with-patch): seed an org-A run with pr_number + thread→repo(token env set via `process.env`); `GET /runs/:id/diff` → 200 with files+patch; cross-org → 404; run with no pr_number → 404. `pnpm test` + tsc. Commit `feat(app): GET /runs/:id/diff (org-scoped PR patch)`.

## Task 2: web — `DiffView` + "View diff" on the PR card

**Files:** `services/web/src/api.ts`, `src/types.ts`, Create `src/components/DiffView.tsx`, `DiffView.test.tsx`; Modify `src/components/PrCard.tsx`, `PrCard.test.tsx`
- [ ] **Step 1:** `types.ts`: `ChangedFile { filename; additions; deletions; status; patch?: string }`. `api.ts`: `runDiff(runId): Promise<ChangedFile[]>` (GET `/runs/:id/diff`, authHeaders).
- [ ] **Step 2:** `DiffView.tsx` — given `files: ChangedFile[]`, render per file: a header (`filename` + `+additions −deletions`), then the `patch` parsed line-by-line into colored rows: lines starting `+` → green bg, `-` → red bg, `@@` → indigo/neutral hunk header, else context (neutral). Monospace, scrollable. Empty/loading states.
- [ ] **Step 3:** `PrCard.tsx` — when `metadata.runId` present, add a **"View diff"** button that toggles a `<DiffView>`; it lazy-loads via an injected `onLoadDiff(runId): Promise<ChangedFile[]>` (thread the callback from MessageItem←ThreadView←App, where it calls `runDiff`). Keep existing card + the approve/decline buttons.
- [ ] **Step 4:** tests — `DiffView.test.tsx`: given a file with a patch (`@@`, `+added`, `-removed`, context), renders the filename, an added line, a removed line (assert they're present; the coloring is class-based). `PrCard.test.tsx`: "View diff" button appears when runId present; clicking it calls `onLoadDiff(runId)` and renders the returned diff. `cd services/web && pnpm test && pnpm build`. Commit `feat(web): in-thread diff viewer on the PR card`.

---

## Self-Review
- Delivers the #17 viewer: see the PR's unified diff in-thread, lazy-loaded, org-scoped. Line-level commenting → `apply_feedback` is the follow-up half of #17.
- Backward-compat: `patch` is an optional ChangedFile field (classifyDiff/policy unaffected); new route/component are additive; org-scoped (reuses #14). Existing suites green.
- Note: GitHub omits `patch` for very large/binary files — DiffView shows a "no preview" line then.

## Definition of Done (18)
Orchestrator + app + web suites green; tsc/build clean. A PR card's "View diff" fetches `GET /runs/:id/diff` (org-scoped) and renders the unified diff with +/− coloring per file. Cross-org diff access denied.
