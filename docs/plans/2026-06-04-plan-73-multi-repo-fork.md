# Plan 73 — Multiple repos per thread + fork (#75)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** conductor 0.25.6 — a workspace/thread spanning **multiple git repos** + **forking** a thread. Add a `thread_repos` join (a thread can reference many repos, one primary), management routes, and `forkThread` (a new thread copying the repo set + a `forkedFrom` marker). The fusion run keeps using the **primary** repo (back-compat); per-run repo selection across the set is a thin follow-up.

**Branch** `plan-73-multi-repo-fork` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: thread_repos + fork

**Files:** `services/app/src/db/schema.ts` + next migration (`0034_thread_repos.sql`), Create `src/nav/thread-repos.ts`, `thread-repos.test.ts`; Modify the thread-create path (`src/nav/*`)
- [ ] **Step 1 — schema/migration:** `thread_repos` table: `orgId`, `threadId`, `repoId`, `isPrimary` (boolean default false), PK (`orgId`,`threadId`,`repoId`). Add `forkedFrom` (text nullable) to `threads`. `pnpm db:migrate`.
- [ ] **Step 2 — module:**
  - `addThreadRepo(db, { orgId, threadId, repoId, isPrimary? })` (org-scoped; repo + thread must be in org; if `isPrimary`, unset other primaries for the thread).
  - `listThreadRepos(db, orgId, threadId)` + `removeThreadRepo(...)`.
  - When a thread is created with a `repoId` (existing path), also insert a `thread_repos` row as primary (keep `threads.repoId` for back-compat).
  - `forkThread(db, { orgId, threadId, byId })` → load the source thread (org-scoped, 404); create a new thread in the same channel (title `Fork of <title>`, `repoId` = the source primary, `forkedFrom = sourceId`); copy the source's `thread_repos` rows; return the new thread. (Shallow fork — repos + wiring, not the message history.)
- [ ] **Step 3 — test:** create a thread with a repo → a primary `thread_repos` row; `addThreadRepo` a 2nd repo → 2 rows, one primary; setting a new primary flips the flag; `forkThread` → a new thread with `forkedFrom` set + the same repo set; cross-org repo/thread → throws/no-op. `DATABASE_URL=… pnpm test -- thread-repos` + tsc. Commit `feat(app): thread_repos (multi-repo) + forkThread (#75)`.

## Task 1: routes

**Files:** Create `services/app/src/http/thread-repos-routes.ts`, `thread-repos-routes.test.ts`; Modify `src/server.ts`
- [ ] `POST /threads/:id/repos { repoId, isPrimary? }`, `GET /threads/:id/repos`, `DELETE /threads/:id/repos/:repoId`, `POST /threads/:id/fork` → all `actor(req).orgId`, org-scoped (404). Register in `server.ts`. Test (`app.inject`): add a repo + list shows both; fork → a new thread id with the repo set; cross-org thread → 404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): thread repos + fork routes (#75)`.

---

## Self-Review
- Delivers #75's core: a thread can reference multiple repos (with a primary), repos are managed via routes, and a thread can be forked (repos + wiring copied, `forkedFrom` recorded). Org-scoped.
- Backward-compat: `threads.repoId` (single, primary) is kept + mirrored into `thread_repos`; the fusion run still uses the primary (unchanged dispatch); additive table/column/routes; org-scoped (#14). Migration additive. Existing suites green.
- Note: dispatching a run against a *non-primary* repo of the thread (per-mention repo selection) + a deep fork (copying messages) are follow-ups; this delivers the multi-repo data model + fork.

## Definition of Done (75)
app suite green; tsc; migration applies. A thread can have multiple repos (one primary) managed via routes; `POST /threads/:id/fork` creates a new thread copying the repo set with `forkedFrom` set; org-scoped (cross-org 404). Existing single-repo runs unchanged.
