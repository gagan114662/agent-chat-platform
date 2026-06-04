# Plan 14 — Security Hardening (audit findings, #36)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Checkbox steps.

**Design (author's call):** Fix the CONFIRMED, exploitable findings from the #36 adversarial audit (3 parallel reviewers). Highest-value cluster: **cross-tenant IDOR** (resources fetched by `:id` without an `org_id` check) + **the GitHub PAT persisted in Temporal args**. Add regression tests that exploit each issue first (TDD), then fix. Keep all existing tests green. Deeper/infra items (fail-closed auth, RLS enforcement, adapter-selection authz, agent ctx cancellation, WS short-lived tickets) are filed as follow-up issues — out of scope here.

**Branch** `plan-14-security` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: Cross-tenant org-scoping (the IDOR cluster) — services/app

Add regression tests proving org B **cannot** access org A's data via a foreign id, then scope every offending query. **Write the failing tests first.**

- [ ] **Step 1: regression tests** — add cross-tenant denial tests:
  - `chat/messages` or a route test: `listMessages` scoped — seed org A thread+message, query as org B → empty/denied.
  - `nav-routes.test.ts`: `GET /channels/:id/threads` for a channel in org A, requested with `x-org-id: o2` → does NOT return org A threads.
  - `memory-routes.test.ts`: `GET /memory/:id/neighbors` for an org A node, as org B → empty.
  - `dm` test: `getOrCreateDm` with a `peerId` from another org → throws "principal not found".
  - `nav` test: `createThread` with a `channelId` from another org → rejected.
  - `tasks` test: `transitionRun(db, runId, ..., orgId)` ignores a run from another org.
  - a WS test: subscribing to a thread whose org ≠ the session's org is rejected.
- [ ] **Step 2: fixes** (thread `orgId` from `actor(req)` into every query; the modules gain an `orgId` param):
  - **`chat/messages.ts`** `listMessages(db, threadId, orgId)` → `and(eq(messages.threadId, threadId), eq(messages.orgId, orgId))`. **`http/routes.ts`**: in BOTH GET and POST `/threads/:id/messages`, first load the thread `WHERE id=:id AND org_id=:actorOrg`; 404 if absent; pass `orgId` to `listMessages`/`createMessage` and only then parse mentions / start runs.
  - **`nav/nav.ts`** `listThreads(db, channelId, orgId)` → add `eq(threads.orgId, orgId)`; `createThread` → verify the channel `WHERE id=:channelId AND org_id=:orgId` exists before insert (throw otherwise). **`nav-routes.ts`** passes `actor(req).orgId`.
  - **`memory/memory.ts`** `neighbors(db, nodeId, orgId)` → scope edges + nodes with `eq(..orgId, orgId)`. **`memory-routes.ts`** `/memory/:id/neighbors` reads `actor(req).orgId` and passes it.
  - **`dm/dm.ts`** `peerName`/`getOrCreateDm` → scope member/agent lookups with `eq(..orgId, orgId)`.
  - **`tasks/tasks.ts`** `transitionRun(db, runId, to, fields, orgId)` → scope select + update + the task cascade with `org_id`. Update the caller in `fusion/events.ts` to pass `ctx.orgId`.
  - **`rbac/rbac.ts`** `roleOf(db, memberId, orgId)` → add `eq(members.orgId, orgId)`; update callers (nav-routes, auth-routes `/auth/me`).
  - **`realtime/ws.ts`** + `server.ts`: after resolving the session principal, load the thread and confirm `org_id` matches before `pubsub.subscribe`; close `1008` otherwise. (Pass a thread-org resolver into `registerWs`, like the token resolver.)
- [ ] **Step 3:** `DATABASE_URL=... pnpm test` (all green incl. new denial tests) + tsc clean. Commit `fix(app): org-scope all by-id access (cross-tenant IDOR, #36)`.

> NOTE: existing tests that call these functions with the OLD signature (no `orgId`) must be updated to pass the org (they seed `o1`); that is a signature change, not an assertion weakening.

---

## Task 1: Keep the GitHub PAT out of Temporal args (#36 C1)

The route currently passes `repoUrl` (with `x-access-token:<PAT>@`) + `githubToken` into the workflow → persisted in Temporal history. Pass only the **env var name**; resolve the token inside the activity (the worker shares the app's env).

- [ ] **Step 1:** change `RunFusionActivityInput` (`fusion/activities.ts`) to drop `githubToken` and the token-bearing `repoUrl`; add `tokenEnvVar: string`. In the activity, resolve `const token = process.env[input.tokenEnvVar]` (throw if missing), build `repoUrl = https://x-access-token:${token}@github.com/${owner}/${repo}.git` locally, and construct `OctokitGitHubService(token)` there.
- [ ] **Step 2:** `http/routes.ts` `startRun` input: pass `owner, repo, baseBranch, intent, branch, tokenEnvVar: repo.tokenEnvVar, sandboxUrl, pollMs, maxPolls, autonomy, sink` — NO raw token / token-URL.
- [ ] **Step 3:** update the integration test's stubbed-activity args (drop githubToken/repoUrl-with-token, add `tokenEnvVar`). Confirm the live chat-e2e still works (it reads `E2E_GITHUB_TOKEN` — set `repo.tokenEnvVar="E2E_GITHUB_TOKEN"`, already seeded). `pnpm test` + tsc. Commit `fix(app): resolve GitHub token inside the activity (keep PAT out of Temporal history, #36)`.

---

## Task 2: Go sandbox-runner hardening (#36)

- [ ] **Step 1:** `internal/sandbox/run.go` `Validate()`: reject `RepoURL` with a leading `-`; require a non-empty host for `http/https/ssh/git`. Gate the `file` scheme behind `os.Getenv("ACP_ALLOW_FILE_REPO") == "1"` (so prod rejects `file://`).
- [ ] **Step 2:** `internal/sandbox/git.go`: add the `--` end-of-options terminator to clone (`git clone --single-branch --branch <branch> -- <repoURL> <dest>`).
- [ ] **Step 3:** `internal/sandbox/redact.go`: broaden `redactCreds` to also redact bare tokens — add patterns for `gh[pousr]_[0-9A-Za-z]+`, `github_pat_[0-9A-Za-z_]+`, `Bearer\s+[\w.\-]+`, `x-access-token:[^@\s/]+`, `AKIA[0-9A-Z]{16}` → replace with `[redacted]`. Keep the existing URL-userinfo rule.
- [ ] **Step 4:** `internal/sandbox/http.go`: wrap the body with `http.MaxBytesReader(w, r.Body, 1<<20)` before decode.
- [ ] **Step 5:** tests — `run_validate_test.go`: a `-`-prefixed RepoURL and a host-less `https://` are rejected; `file://` rejected unless `ACP_ALLOW_FILE_REPO=1`. `redact_test.go`: a bare `ghp_…` / `Bearer …` is redacted. **Set `ACP_ALLOW_FILE_REPO=1`** (via `t.Setenv`) in the existing tests that use `file://` (`TestHandleRun`, `TestHandleRunRejectsInvalid` uses ftp so fine, and the git_test clone tests use raw filesystem paths → `CloneInto` is called directly, not via Validate, so they're unaffected; only the HTTP handler path runs Validate — set the env in those handler tests). Run `go build/vet/test ./...` green. Commit `fix(sandbox): reject file:// by default, git -- terminator, broaden cred redaction, body size limit (#36)`.

---

## Task 3: Web — `prUrl` scheme validation

- [ ] **Step 1:** `services/web/src/components/PrCard.tsx`: only render the `<a href={m.prUrl}>` when `prUrl` starts with `https://`; otherwise render the PR number as plain text. Keep `rel="noreferrer" target="_blank"`. Add/extend the PrCard/MessageItem test: a `javascript:`/non-https `prUrl` is NOT rendered as a link.
- [ ] **Step 2:** `cd services/web && pnpm test && pnpm build`. Commit `fix(web): only render https pr_url as a link (#36)`.

---

## Self-Review
- Closes the exploitable audit findings: cross-tenant IDOR (T0), PAT-in-Temporal (T1), runner hardening (T2), prUrl (T3). Regression tests prove each.
- Backward-compat: org-scoping adds an `orgId` param to several functions — update all call sites + their tests (signature change, not weakening). The Go `file://` gate is set in the handler tests via `ACP_ALLOW_FILE_REPO`.
- **Filed as follow-ups (not here):** fail-closed auth default (make `actor` default-deny when `AUTH_REQUIRE_SESSION` unset — test-impacting), Postgres RLS enforcement, server-side adapter-selection authorization, thread request ctx into the agent (cancellation), credentials out of git argv (credential helper), short-lived WS tickets, message/thread/dm RBAC checks.

## Definition of Done (14)
App + orchestrator + Go + web suites green incl. the new cross-tenant denial + redaction + prUrl tests; tsc/build clean. Org B can no longer read/write/stream org A's threads/messages/threads-list/memory/DMs by id; the PAT is no longer in Temporal history; the runner rejects `file://` + `-`-prefixed URLs and redacts bare tokens; the UI won't render a non-https PR link.
