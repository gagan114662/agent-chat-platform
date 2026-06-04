# Plan 41 — Issue import: Linear + GitHub Issues → Tasks (#22)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** conductor 0.15/0.32 + reload Linear — create Tasks from external issues. Pull **Linear** issues (via the Linear GraphQL API, key from `LINEAR_API_KEY` env) and **GitHub** issues (via the existing Octokit `GitHubService`, repo token) into Tasks, **idempotent** (deterministic task id per source issue), org-scoped, behind import routes. The client is injectable so tests use fakes (no live API). Webhook-driven auto-import + status write-back are follow-ups (webhook needs the public deploy URL #103).

**Branch** `plan-41-issue-import` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: Linear importer

**Files:** Create `services/app/src/integrations/linear.ts`, `linear.test.ts`, `src/http/integration-routes.ts`, `integration-routes.test.ts`; Modify `src/server.ts`; reuse `src/tasks/tasks.ts` (`openTaskForMention` or a direct task insert)
- [ ] **Step 1 — `linear.ts`:**
  - `LinearIssue = { id: string; identifier: string; title: string; description?: string; state: string; url: string }`.
  - `LinearClient` interface: `listIssues(opts?: { first?: number }): Promise<LinearIssue[]>`.
  - `makeLinearClient(apiKey: string): LinearClient` — real impl POSTs to `https://api.linear.app/graphql` with header `Authorization: <apiKey>` and a query like `{ issues(first: N) { nodes { id identifier title description state { name } url } } }`, maps `state.name`→`state`. (Use the app's node-fetch/global fetch.)
  - `importLinearIssues(db, { orgId, threadId, client }): Promise<string[]>` — for each issue, create a Task with deterministic id `linear:${issue.id}` (`onConflictDoNothing` → idempotent), `title = "[" + issue.identifier + "] " + issue.title`, `state: "open"`, `createdByKind: "integration"`, `createdById: "linear"`, on the given thread (org-scoped). Return the created task ids.
- [ ] **Step 2 — route (`integration-routes.ts`):** `registerIntegrationRoutes(app, d: { db, makeLinear? })`: `POST /integrations/linear/import { threadId }` → `actor(req).orgId`; thread must be in org (404); `const key = process.env.LINEAR_API_KEY` (400 if missing); `const client = (d.makeLinear ?? makeLinearClient)(key)`; `importLinearIssues(db, {orgId, threadId, client})`; return `{ imported: ids.length, ids }`. Register in `server.ts`.
- [ ] **Step 3 — tests:** `linear.test.ts` (fake client → 2 issues): `importLinearIssues` → 2 Tasks with `[IDENT] title`; **re-import → 0 new** (deterministic id); org-scoped (cross-org thread rejected at the route). `integration-routes.test.ts` (`app.inject`, inject `makeLinear` fake): import → `{imported:2}`; `LINEAR_API_KEY` unset → 400; cross-org thread → 404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): Linear issue → Task importer (#22)`.

## Task 1: GitHub Issues importer

**Files:** `services/orchestrator/src/github/{github-service,octokit-github-service,octokit-github-service.test}.ts` (+ fakes), `services/app/src/integrations/github-issues.ts`, `github-issues.test.ts`, `src/http/integration-routes.ts` (add route)
- [ ] **Step 1 — orchestrator:** add `GitHubService.listIssues(owner, repo, opts?): Promise<{ number: number; title: string; body?: string; state: string; htmlUrl: string }[]>` (Octokit `issues.listForRepo`, filter out PRs — `!issue.pull_request`). nock test + fakes updated.
- [ ] **Step 2 — app:** `importGitHubIssues(db, { orgId, threadId, owner, repo, github }): Promise<string[]>` — deterministic task id `gh:${owner}/${repo}#${number}`, `title = "#" + number + " " + issue.title`, idempotent, org-scoped.
- [ ] **Step 3 — route:** `POST /integrations/github/import { threadId }` → resolve thread→repo (org-scoped) + token (`process.env[repo.tokenEnvVar]`, 400 if missing); `github = (d.makeGitHub ?? OctokitGitHubService)(token)`; import from `repo.githubOwner/githubName`. Return `{ imported, ids }`.
- [ ] **Step 4 — tests:** fake github → 2 issues (1 PR filtered out) → 2 Tasks, idempotent re-import → 0; cross-org → 404; no token → 400. `pnpm test` (orchestrator + app) + tsc. Commit `feat(app): GitHub Issues → Task importer (#22)`.

---

## Self-Review
- Delivers #22: pull Linear + GitHub issues into Tasks, idempotent (deterministic ids → safe re-import), org-scoped, behind import routes, with injectable clients (fake-tested; real Linear uses `LINEAR_API_KEY`, GitHub uses the repo token). The Linear key is now configured (env/Fly secret) so this works live once invoked.
- Backward-compat: additive integrations module + routes; `listIssues` interface addition → update fakes; org-scoped (#14). Existing suites green.
- Note: webhook-driven auto-import (Linear/GitHub webhooks → Task on issue.created) needs the public deploy URL (#103/#23) — a follow-up. Status write-back (Task done → close the issue) is a follow-up.

## Definition of Done (22)
orchestrator + app suites green; tsc. `POST /integrations/linear/import` and `POST /integrations/github/import` create org-scoped Tasks from issues, idempotently; missing key/token → 400; cross-org → 404. Live Linear uses the configured `LINEAR_API_KEY`.
