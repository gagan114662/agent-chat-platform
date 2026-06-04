# Plan 33 — Editable PR title/description + target-branch (#56)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** conductor 0.34.1/0.28.7 — edit a run's PR title/description and switch its base branch in-thread. Backend: `GitHubService.updatePr` (Octokit `pulls.update`) + an org-scoped `POST /runs/:id/update-pr`. Web: an Edit toggle on the PR card. Pairs with stacked PRs (#53 — switching base to a parent branch).

**Branch** `plan-33-editable-pr` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: orchestrator — `updatePr`

**Files:** `services/orchestrator/src/github/github-service.ts`, `octokit-github-service.ts`, `octokit-github-service.test.ts`, fakes in `run-fusion.test.ts`/`traced-fusion.test.ts`
- [ ] Add to `GitHubService`: `updatePr(owner, repo, prNumber, patch: { title?: string; body?: string; base?: string }): Promise<void>`. Octokit impl: `await this.octokit.pulls.update({ owner, repo, pull_number: prNumber, ...patch })`. Add a nock test (PATCH `/repos/o/r/pulls/7` with `{title:"x"}` → 200). Add `updatePr: vi.fn().mockResolvedValue(undefined)` to every `GitHubService` fake. `pnpm test` + tsc. Commit `feat(orchestrator): GitHubService.updatePr (#56)`.

## Task 1: app — `POST /runs/:id/update-pr`

**Files:** Create `services/app/src/http/pr-edit-routes.ts`, `pr-edit-routes.test.ts`; Modify `src/server.ts`
- [ ] **Step 1:** `registerPrEditRoutes(app, d: { db, makeGitHub? })`: `POST /runs/:id/update-pr { title?, body?, base? }` → `actor(req).orgId`; load run org-scoped (404), need `pr_number` (404 if none); resolve run→task→thread→repo (org-scoped) + token (`process.env[repo.tokenEnvVar]`, 400 if missing); `const gh = (d.makeGitHub ?? ((t)=>new OctokitGitHubService(t)))(token)`; `await gh.updatePr(repo.githubOwner, repo.githubName, run.prNumber, { title, body, base })` (only pass provided fields); return `{ ok: true }`. Register in `server.ts`.
- [ ] **Step 2 — test** (`app.inject`, fake `makeGitHub`): seed org-A run with pr_number + thread→repo(token env set); `POST /runs/:id/update-pr {title:"new"}` → 200 and the fake `updatePr` called with `{title:"new"}`; cross-org → 404; no pr_number → 404; missing token → 400. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): POST /runs/:id/update-pr (org-scoped PR edit) (#56)`.

## Task 2: web — Edit on the PR card

**Files:** `services/web/src/api.ts`, `src/components/PrCard.tsx`, `PrCard.test.tsx`
- [ ] **Step 1:** `api.ts`: `updatePr(runId, patch: { title?: string; body?: string; base?: string }): Promise<{ ok: boolean }>` (POST, authHeaders).
- [ ] **Step 2:** `PrCard.tsx`: when `metadata.runId` present, an **"Edit"** toggle reveals title + description inputs + a base-branch input; Save calls an injected `onUpdatePr(runId, patch)` (thread App→ThreadView→MessageItem like the others; App calls `updatePr` then `refetch`). Keep existing buttons (approve/decline/view-diff/sync/stacked badge).
- [ ] **Step 3 — test:** `PrCard.test.tsx`: Edit toggle appears with a runId; editing the title + Save calls `onUpdatePr("run1", { title: "new title" })`. `cd services/web && pnpm test && pnpm build`. Commit `feat(web): edit PR title/description/base on the PR card (#56)`.

---

## Self-Review
- Delivers #56: edit a run's PR title/body and switch its base branch in-thread, org-scoped. Base-switch pairs with stacked PRs (#53).
- Backward-compat: `updatePr` interface addition → update all fakes; new route/UI additive; org-scoped (#14). Only provided patch fields are sent. Existing suites green.

## Definition of Done (56)
orchestrator + app + web suites green; tsc/build clean. A PR card's Edit saves title/description/base via `POST /runs/:id/update-pr` (org-scoped, via the repo token); cross-org denied.
