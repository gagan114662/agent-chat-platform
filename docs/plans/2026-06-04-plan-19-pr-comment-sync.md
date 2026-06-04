# Plan 19 — PR comment sync (GitHub → thread) (#19)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps.

**Design (author's call):** Bring GitHub PR review comments into the thread (the request-changes inflow). On-demand pull: `POST /runs/:id/sync-comments` fetches the run's PR review comments and posts each into the thread as a message — **idempotent** via deterministic message ids (`${runId}:rc:${commentId}` + `onConflictDoNothing`), so re-syncing never double-posts. The automatic webhook/poller (needs the GitHub App, #23) and auto-feeding comments to `apply_feedback` are follow-ups; this delivers the inflow + idempotent dedupe.

**Branch** `plan-19-pr-comment-sync` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: orchestrator — `listReviewComments`

**Files:** `services/orchestrator/src/github/github-service.ts`, `octokit-github-service.ts`, `octokit-github-service.test.ts`
- [ ] Add to `GitHubService`: `listReviewComments(owner, repo, prNumber): Promise<ReviewComment[]>` where `ReviewComment = { id: number; body: string; user: string; path?: string; line?: number }`. Octokit impl uses `pulls.listReviewComments({owner, repo, pull_number})` → map `{ id, body, user: c.user?.login ?? "?", path: c.path, line: c.line ?? undefined }`. Add a nock test (GET `/repos/o/r/pulls/7/comments` → 200 with 2 comments). Add `listReviewComments` to every `GitHubService` fake (run-fusion.test, traced-fusion.test → `vi.fn().mockResolvedValue([])`). `pnpm test` + tsc. Commit `feat(orchestrator): GitHubService.listReviewComments`.

## Task 1: app — `POST /runs/:id/sync-comments` (idempotent)

**Files:** Create `services/app/src/http/comment-sync-routes.ts`, `comment-sync-routes.test.ts`; Modify `src/server.ts`
- [ ] **Step 1:** `registerCommentSyncRoutes(app, d: { db, sql, makeGitHub? })`: `POST /runs/:id/sync-comments` → `actor(req).orgId`; load run `WHERE id AND org_id` (404); needs `pr_number` (404 if none); resolve thread→repo (org-scoped) + token (`process.env[repo.tokenEnvVar]`, 400 if missing); `gh = (d.makeGitHub ?? (t=>new OctokitGitHubService(t)))(token)`; `const comments = await gh.listReviewComments(owner, repo, run.prNumber)`; for each, `createMessage(db, { id: \`${run.id}:rc:${c.id}\`, orgId, threadId: <run's thread>, authorKind:"agent", authorId:<run.assignee or a fixed "github">, kind:"system", body: \`💬 ${c.user}${c.path?` on ${c.path}${c.line?`:${c.line}`:""}`:""}: ${c.body}\`, metadata:{ reviewCommentId: c.id, path: c.path, line: c.line } })` (createMessage already `onConflictDoNothing` → idempotent) + `notify(sql, THREAD_CHANNEL, {threadId, message})` only for newly-inserted ones; return `{ synced: <count of NEW messages> }`. Register in `server.ts`.
  - To know the run's threadId: run→task→thread (the task has threadId). Resolve it.
- [ ] **Step 2:** `comment-sync-routes.test.ts` (`app.inject`, inject fake `makeGitHub` returning 2 review comments): seed org-A run (pr_number) + task + thread + repo(token env set); first POST → `{synced:2}` and 2 `system` messages with `💬` in the thread; **second POST → `{synced:0}`** (idempotent, no dupes — same deterministic ids). Cross-org → 404. `pnpm test` + tsc. Commit `feat(app): POST /runs/:id/sync-comments (idempotent PR-comment inflow)`.

## Task 2: web — "Sync PR comments" on the PR card

**Files:** `services/web/src/api.ts`, `src/components/PrCard.tsx`, `PrCard.test.tsx`
- [ ] `api.ts`: `syncPrComments(runId): Promise<{ synced: number }>` (POST, authHeaders). `PrCard.tsx`: when `metadata.runId` present, add a small **"↻ Sync comments"** button (alongside View diff / approve-decline) calling an injected `onSyncComments(runId)` (threaded App→ThreadView→MessageItem like the others; App calls `syncPrComments` then `refetch()` — synced comments also arrive via WS). `PrCard.test.tsx`: the button appears with a runId and clicking calls `onSyncComments("run1")`. `cd services/web && pnpm test && pnpm build`. Commit `feat(web): sync-PR-comments button on the PR card`.

---

## Self-Review
- Delivers #19 inflow: GitHub PR review comments → thread, idempotent (deterministic ids), org-scoped, on demand. Auto-poll/webhook (needs GitHub App #23) + auto-`apply_feedback` from comments are follow-ups.
- Backward-compat: `listReviewComments` interface addition → update all fakes; new route/UI additive; org-scoped (#14). Existing suites green.

## Definition of Done (19)
Orchestrator + app + web suites green; tsc/build clean. `POST /runs/:id/sync-comments` pulls the PR's review comments into the thread once (idempotent on re-sync), org-scoped; the PR card has a "Sync comments" button. Webhook-driven auto-sync remains a follow-up tied to #23.
