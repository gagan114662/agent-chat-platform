# Plan 69 — Conversation summarization (#77) + start-from-PR (#78)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's calls):** two bounded conductor-parity features.
- **#77 summarization** (Insta-Summarize): summarize a thread's messages into a recap. Injectable summarizer (LLM-pluggable; default = deterministic rule-based: message/author counts + key PR/outcome/task lines). `POST /threads/:id/summarize` → posts a `system` summary message.
- **#78 start-from-PR** (Checkout PRs): open a thread + task seeded from an existing GitHub PR — pull its changed files (#17) + review comments (#19) into the new thread. `POST /integrations/github/from-pr { owner, repo, prNumber }`. Both org-scoped, reusing existing services.

**Branch** `plan-69-summarize-frompr` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: conversation summarization (#77)

**Files:** Create `services/app/src/chat/summarize.ts`, `summarize.test.ts`, route in `src/http/routes.ts` (or a new file); Modify `src/server.ts`
- [ ] **Step 1 — `summarize.ts`:** `summarizeThread(db, { orgId, threadId, summarize? }): Promise<{ summary: string }>` — load the thread's messages (org-scoped); build a deterministic recap via `summarize ?? defaultSummarizer`: `defaultSummarizer(messages)` → "N messages from K participants (humans/agents). Key events: <pr_card/plan_card/outcome lines>. Latest: <last message snippet>." (Injectable so an LLM summarizer can replace it.)
- [ ] **Step 2 — route:** `POST /threads/:id/summarize` → `actor(req).orgId`; thread org-scoped (404); `summarizeThread`; post the summary as an agent `system` message (kind `system`, body the summary) + notify; return `{ summary }`. (Reuse createMessage + notify.) Register in `server.ts`.
- [ ] **Step 3 — test:** seed a thread with a few messages incl. a `pr_card` outcome → `summarizeThread` returns a recap mentioning the count + the PR; the route posts a system message + returns it; cross-org thread → 404; empty thread → a sensible "no messages" summary. `DATABASE_URL=… pnpm test -- summarize` + tsc. Commit `feat(app): conversation summarization (#77)`.

## Task 1: start a thread from an existing PR (#78)

**Files:** `services/app/src/integrations/from-pr.ts`, `from-pr.test.ts`, route in `src/http/integration-routes.ts`; reuse `GitHubService` (getChangedFiles, listReviewComments), nav (createChannel/thread), tasks
- [ ] **Step 1 — `from-pr.ts` `startFromPr(db, { orgId, channelId, owner, repo, prNumber, github }): Promise<{ threadId; taskId }>`:** create a thread (org-scoped, in the given channel; title `PR #<n> <owner>/<repo>`) wired to the matching `repos` row (so runs can target it); create a Task (id `from-pr:${owner}/${repo}#${prNumber}`, idempotent); post the PR's changed-file summary (`getChangedFiles`) + review comments (`listReviewComments`) as system/`pr_card` messages into the thread (deterministic message ids → idempotent re-import). Return the ids.
- [ ] **Step 2 — route:** `POST /integrations/github/from-pr { channelId, owner, repo, prNumber }` → `actor(req).orgId`; resolve the org's repo for owner/repo (org-scoped) + token (400 if none); `github = (d.makeGitHub ?? OctokitGitHubService)(token)`; `startFromPr(...)`; return `{ threadId, taskId }`. Register (it's in `integration-routes.ts` which is already registered).
- [ ] **Step 3 — test** (fake makeGitHub returning files + comments): seed org-A channel + a repo(token); `POST /integrations/github/from-pr {…prNumber:7}` → a new thread + task + the PR files/comments posted; **re-run → idempotent** (no dup task/messages); cross-org repo → 404; no token → 400. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): start a thread/task from an existing GitHub PR (#78)`.

---

## Self-Review
- #77: ask the system to recap a thread (deterministic now, LLM-pluggable) → posted in-thread, org-scoped. #78: ingest an existing PR (diff + comments) into a new thread+task so an agent can pick it up (the reverse of agent→PR), idempotent, org-scoped — pairs with PR-comment feedback (#19) + the now-real ApplyFeedback (#66).
- Backward-compat: additive modules/routes; both reuse existing services (messages/notify, GitHubService, nav/tasks); deterministic + injectable; org-scoped (#14). No migration. Existing suites green.
- Note: LLM-backed summaries (#77) + auto-dispatching an agent run on the imported PR (#78) are thin follow-ups on these.

## Definition of Done (77, 78)
app suite green; tsc. `POST /threads/:id/summarize` posts + returns a recap (org-scoped); `POST /integrations/github/from-pr` creates a thread+task seeded with the PR's diff + comments, idempotently (cross-org 404, no token 400).
