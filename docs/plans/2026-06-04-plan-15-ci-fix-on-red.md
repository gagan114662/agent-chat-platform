# Plan 15 — CI Fix-on-Red Loop (Agent-Merge behavior, #18)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps.

**Design (author's call):** Spec §5's "actively drive CI green" loop. On `checks_failed`, instead of giving up, the orchestrator fetches the failing-check context, asks the agent to fix it on the SAME branch (a re-clone + `ApplyFeedback` + push via a new sandbox `/feedback` endpoint), and re-polls — bounded by N attempts; still red after N → `held_for_human`. Default `maxFixAttempts: 0` keeps today's behavior (existing tests unchanged). Persistent sandboxes are a later optimization; this re-clones the branch each attempt.

**Branch** `plan-15-ci-fix-on-red` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: Sandbox-runner `/feedback` (re-run the agent on an existing branch)

**Files:** `services/sandbox-runner/internal/sandbox/{feedback.go,feedback_test.go,http.go}`, `adapter/fake.go`

- [ ] **Step 1:** make `FakeAdapter.ApplyFeedback` actually change the repo (so the diff updates) — write/append a `FEEDBACK.md` with the notes (mirror `Run`'s file write), and still emit log+done. Update its test if needed.
- [ ] **Step 2:** `feedback.go`: `FeedbackRequest{ RepoURL, Branch, Notes, Adapter string; WorkDir string \`json:"-"\` }` + `Validate()` (reuse `validRef`/scheme rules; same `-`/host/file gate). `Feedback(ctx, req)`: clone the **branch** (`CloneInto(ctx, req.RepoURL, req.Branch, req.WorkDir)`), resolve the adapter from `adapter.DefaultRegistry()`, `Prepare`, call `adapter.ApplyFeedback(ctx, req.Notes, noopEmit)`, then commit+push to the SAME branch — add a `CommitAllAndPushExisting(ctx, repoDir, branch, message)` to git.go that does NOT `checkout -b` (the branch already exists from the clone) — i.e. `add -A` + `commit` + `push origin HEAD:branch`; return the new SHA.
- [ ] **Step 3:** `http.go`: add `POST /feedback` (MaxBytesReader + DisallowUnknownFields + Validate + redact errors), `MkdirTemp` worktree, resolve adapter, return `{branch, commitSha}` (`RunResult` shape).
- [ ] **Step 4:** `feedback_test.go`: against a `makeBareRepoWithCommit` fixture, push a feature branch, POST `/feedback` with notes → 200, and a re-clone of the branch shows `FEEDBACK.md` with the notes + a new commit. `t.Setenv("ACP_ALLOW_FILE_REPO","1")`. `go build/vet/test ./...` green.
- [ ] **Step 5:** commit `feat(sandbox): /feedback endpoint (re-run agent ApplyFeedback on a branch)`.

---

## Task 1: Orchestrator — CI-resolution loop in `runFusion`

**Files:** `services/orchestrator/src/github/{github-service.ts,octokit-github-service.ts,octokit-github-service.test.ts}`, `src/core/run-fusion.ts`, `src/core/run-fusion.test.ts`

- [ ] **Step 1:** `GitHubService.getCheckFailureContext(owner, repo, ref): Promise<string>` — Octokit impl summarizes failing contexts from `getCombinedStatusForRef` (names of statuses with state `failure`/`error`) into a short string; add to the interface + a nock test + the run-fusion fake (`getCheckFailureContext: vi.fn().mockResolvedValue("ci: lint failed")`).
- [ ] **Step 2:** extend `FusionOptions`:
```ts
  maxFixAttempts?: number; // default 0
  ciFix?: (info: { branch: string; commitSha: string; prNumber: number; failure: string }) => Promise<{ commitSha: string }>;
```
  and add a `FusionEvent` variant `{ type: "ci_fix_attempt"; attempt: number; failure: string }`.
- [ ] **Step 3:** in the poll loop, on `status === "failure"`: if `opts.ciFix` is set and `fixes < (opts.maxFixAttempts ?? 0)`, then `fixes++`; `const failure = await deps.github.getCheckFailureContext(owner, repo, run.commitSha)`; `await emit({type:"ci_fix_attempt", attempt: fixes, failure})`; `const fixed = await opts.ciFix({branch: run.branch, commitSha: run.commitSha, prNumber: pr.number, failure})`; update `run.commitSha = fixed.commitSha`; reset the poll index (`i = -1` so the loop re-polls from scratch on the new commit) and `continue`. Otherwise behave as today (return `checks_failed`). Keep `mergeGate`/`held_for_human` logic intact.
- [ ] **Step 4:** tests — with `deps` whose checks go `["failure","success"]`, `maxFixAttempts: 1` + a `ciFix` mock returning a new sha → outcome `merged`, `ciFix` called once, `getCheckFailureContext` called. With `maxFixAttempts: 0` (default) → `checks_failed`, `ciFix` not called (existing behavior). Existing run-fusion tests stay green (no ciFix/maxFixAttempts passed). `pnpm test` + tsc.
- [ ] **Step 5:** commit `feat(orchestrator): CI fix-on-red loop in runFusion (bounded, opt-in)`.

---

## Task 2: App — wire `ciFix` into the activity

**Files:** `services/app/src/sandbox/sandbox-runner-client.ts` (orchestrator pkg), `services/app/src/fusion/activities.ts`, integration test

- [ ] **Step 1:** add `SandboxRunner.feedback(req: { repoUrl; branch; notes; adapter? }): Promise<RunResult>` to `SandboxRunnerClient` (POST `/feedback`, same transport as `run`); add to the `SandboxRunner` interface + its fake in run-fusion.test (returns `{branch, commitSha:"fixsha"}`).
- [ ] **Step 2:** in `runChatFusionActivity`, build `ciFix` = async ({branch, failure}) => the sandbox client `.feedback({ repoUrl, branch, notes: failure, adapter })` → `{commitSha}`; pass `maxFixAttempts: Number(process.env.CI_FIX_ATTEMPTS ?? 2)` + `ciFix` to `runFusionTraced`. (repoUrl is built from the env token like the run path.)
- [ ] **Step 3:** the sink already handles step events; add a `describe` line for `ci_fix_attempt` (`🔧 CI fix attempt {attempt}: {failure}`) in `events.ts` and an idempotent runEvent (it flows through the same emitter). `pnpm test` + tsc.
- [ ] **Step 4:** commit `feat(app): wire CI fix-on-red into the fusion activity (CI_FIX_ATTEMPTS)`.

---

## Self-Review
- Spec §5 Agent-Merge loop: bounded fix-on-red, escalate to human (`held_for_human` via the merge gate, or `checks_failed` when no gate) after N attempts.
- Backward-compat: `maxFixAttempts` defaults 0 + `ciFix` optional → `runFusion` unchanged without them (existing tests green). New `SandboxRunner.feedback` + `getCheckFailureContext` are interface additions → update fakes. The `/feedback` endpoint is additive.
- Note: re-clones the branch per attempt (no persistent sandbox); real sandbox lifecycle + richer failure logs (actual CI job logs vs combined-status names) are follow-ups. The fixture repo's always-green workflow means a live e2e won't exercise the red path; covered by unit tests with fake deps.

## Definition of Done (15)
Go + orchestrator + app suites green incl. the fix-on-red tests (failure→fix→merge) and the default-off path; `/feedback` re-runs the agent on a branch. With `CI_FIX_ATTEMPTS>0`, a red PR triggers up to N agent fix attempts before escalating.
