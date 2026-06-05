# Plan 66 — Per-repo setup/run scripts (#71)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** conductor 0.9/0.11/0.31 — run a per-repo **setup script** (install deps, build) after clone and BEFORE the agent, so non-trivial repos work. The script is **admin-configured on the repo** (trusted config, not cloned-repo content), threaded to the sandbox, run in the workdir with a timeout (bounded by #50), output streamed as events. Lifecycle hooks (pre/post-run) + setup-script logs in-thread are thin follow-ups.

**Branch** `plan-66-setup-scripts` (off `main`). Go in `services/sandbox-runner`; small app migration. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: sandbox runs the setup script (Go)

**Files:** `services/sandbox-runner/internal/sandbox/{run,plan,feedback,http}.go`, Create `internal/sandbox/setup.go`, `setup_test.go`
- [ ] **Step 1 — request field:** add `SetupScript string \`json:"setupScript,omitempty"\`` to `RunRequest` (and `PlanRequest`/`FeedbackRequest` if the agent should also see a prepared repo there — yes for run+feedback). No `Validate` charset restriction (it's a shell script by design) BUT it's only ever populated from the trusted repo config, never from cloned content.
- [ ] **Step 2 — `setup.go` `runSetupScript(ctx, repoDir, script string, onLine func(string)) error`:** if `script == ""` → no-op. Else `exec.CommandContext(ctx, "bash", "-lc", script)` with `cmd.Dir = repoDir`, stream combined stdout+stderr lines to `onLine` (same streaming pattern as the claude CLI), return the run error (a non-zero exit → error). Honors `ctx` (timeout/cancel from #50).
- [ ] **Step 3 — wire into `Run`/`Feedback`:** after `CloneIntoDepth` + `checkRepoSize` and BEFORE `agent.Apply`, call `runSetupScript(ctx, req.WorkDir, req.SetupScript, …)` (the `Run` already has an event/emit path — stream as log lines; if `Run` takes a plain `Agent`, route the setup output to a no-op or a passed emitter — match the existing signature). On setup failure → return a wrapped error (the run fails before the agent). `http.go` passes `req.SetupScript`.
- [ ] **Step 4 — test (`setup_test.go`):** `runSetupScript(ctx, dir, "echo hi > marker.txt", onLine)` → `dir/marker.txt` exists + "hi" not required, and onLine captured output; `runSetupScript(ctx, dir, "exit 3", …)` → error; `""` → no-op. An HTTP `/run` test (file:// fixture, `ACP_ALLOW_FILE_REPO=1`) with a `setupScript` that writes a file → the agent (fake) then runs on a repo where the marker exists (assert via the pushed branch containing it, or that setup ran). `go build/vet/test ./...`. Commit `feat(sandbox): run per-repo setup script after clone, before agent (#71)`.

## Task 1: repo config + threading (App)

**Files:** `services/app/src/db/schema.ts` + next migration (`0030_repo_setup_script.sql`), `src/fusion/start.ts` + `activities.ts`, `src/sandbox/...` client (orchestrator `sandbox-runner-client` SetupScript field), tests
- [ ] **Step 1 — schema/migration:** add `setupScript` (text nullable) to `repos`. `pnpm db:migrate`.
- [ ] **Step 2 — thread it:** orchestrator `SandboxRunner.run`/`feedback` request types gain `setupScript?`; `FusionInput` carries it; the activity reads `repo.setupScript` and passes it (like the token/intent). `StartFusionRunInput` already has `repo` — surface `setupScript` from it. Update fakes (ignore the optional field).
- [ ] **Step 3 — route to set it (optional, admin):** a `PATCH /repos/:id { setupScript }` (admin, org-scoped) OR just the column + threading (the repo is seeded/configured directly). Minimal: column + threading + a test that a repo with `setupScript` passes it to the sandbox run (fake sandbox asserts the field). `DATABASE_URL=… pnpm test` (app + orchestrator) + tsc. Commit `feat(app): per-repo setupScript threaded into the run (#71)`.

---

## Self-Review
- Delivers #71: a per-repo, admin-configured setup script runs in the sandbox after clone + before the agent (deps installed → real repos work), streamed + bounded by the #50 timeout, threaded app→orchestrator→sandbox.
- Backward-compat: `setupScript` optional/nullable → no script = today's behavior; the script is only ever the trusted repo config (never cloned content); fakes ignore the new field. Migration additive. Existing suites green.
- Note: lifecycle hooks (pre/post-run), in-thread setup logs, and a `conductor.json`/`.acp/` checked-in config source (vs the column) are follow-ups; this delivers the core setup-before-agent step.

## Definition of Done (71)
go + app + orchestrator suites green; tsc; migration applies. A repo with a `setupScript` runs it (bash, in the workdir, ctx-bounded) after clone and before the agent; a failing script fails the run; no script = unchanged. Threaded end-to-end.
