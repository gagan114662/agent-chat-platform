# Plan 74 — Terminal: command-exec core (#72)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** conductor 0.29.5/0.46/0.48 — an interactive terminal + agent-readable terminal. Deliver the **backend exec core**: a sandbox `POST /exec` that runs a command in a fresh clone of a repo, captures combined output + exit code, bounded by the #50 limits, default-deny authorized (it's code execution — gated like adapters #38), plus an org-scoped app route. The interactive PTY session + xterm.js UI + persistent terminal are the documented follow-up (fold into #102).

**Branch** `plan-74-terminal-exec` (off `main`). Go in `services/sandbox-runner`; app. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: sandbox `/exec` (Go)

**Files:** Create `services/sandbox-runner/internal/sandbox/exec.go`, `exec_test.go`; Modify `internal/sandbox/http.go`
- [ ] **Step 1 — `exec.go`:** `ExecRequest{ RepoURL, BaseBranch, Command string; WorkDir string \`json:"-"\` }` + `Validate()` (reuse the scheme/ref rules; `Command` non-empty, length-capped). `Exec(ctx, req, limits) (ExecResult, error)`: shallow-clone (`CloneIntoDepth`), `checkRepoSize`, run `bash -lc <command>` in the workdir (reuse the `runSetupScript`-style streaming; capture combined output up to a byte cap), return `ExecResult{ Output string; ExitCode int }`. (Apply repo `Env` if you want parity with #73 — optional.)
- [ ] **Step 2 — `http.go`:** `POST /exec` — `MaxBytesReader` + `DisallowUnknownFields` + `Validate`; require an **authz gate** (this is arbitrary code exec): only allowed when `ACP_ALLOW_EXEC=1` (default-deny → 403) so it isn't open by default; `MkdirTemp` workdir; `context.WithTimeout` (#50); return `ExecResult` JSON (redact creds on errors). 
- [ ] **Step 3 — test (`exec_test.go`):** with `ACP_ALLOW_EXEC=1` + the file:// fixture (`ACP_ALLOW_FILE_REPO=1`), `POST /exec` with `command:"echo hello && exit 0"` → 200, output contains "hello", exitCode 0; `command:"exit 7"` → exitCode 7 (200 with the result, or a result carrying the code); without `ACP_ALLOW_EXEC` → 403; oversize body → 413. `go build/vet/test ./...`. Commit `feat(sandbox): /exec — run a command in a clone (default-deny ACP_ALLOW_EXEC) (#72)`.

## Task 1: app route + orchestrator client

**Files:** `services/orchestrator/src/sandbox/sandbox-runner-client.ts` (add `exec`), Create `services/app/src/http/exec-routes.ts`, `exec-routes.test.ts`; Modify `src/server.ts`
- [ ] **Step 1 — client:** `SandboxRunner.exec(req: { repoUrl; baseBranch; command }): Promise<{ output: string; exitCode: number }>` (POST `/exec`). Add to the interface + fakes.
- [ ] **Step 2 — route:** `POST /threads/:id/exec { command }` (or `/repos/:id/exec`) → `actor(req)`, **admin-gated** (`team:manage`), org-scoped; resolve the thread's repo + token (400 if none); build the repoUrl (like the activity) and `sandbox.exec({ repoUrl, baseBranch, command })`; return `{ output, exitCode }`. (Admin-only because it's arbitrary code exec; ties to the autonomy/authz model.) Register in `src/server.ts` (inject the sandbox client / a `makeSandbox` seam so tests use a fake).
- [ ] **Step 3 — test** (`app.inject`, fake sandbox exec): admin `POST /threads/:id/exec {command:"ls"}` → `{output, exitCode}` from the fake; non-admin → 403; cross-org thread → 404; no token → 400. `DATABASE_URL=… pnpm test` (app + orchestrator) + tsc. Commit `feat(app): admin exec route → sandbox /exec (#72)`.

---

## Self-Review
- Delivers #72's backend core: run a command in a repo checkout with captured output + exit code, **default-deny** (`ACP_ALLOW_EXEC` on the sandbox + admin-gated on the app), bounded by #50. This is the "agent/operator can run a command and read the output" primitive.
- Backward-compat: additive endpoint/route; `/exec` is off unless `ACP_ALLOW_EXEC=1` (safe default); admin-only; org-scoped (#14). `SandboxRunner.exec` interface addition → update fakes. Existing suites green.
- Note: a **persistent interactive PTY** (bidirectional, streamed over WS, xterm.js UI) + `@terminal` chat context are the remaining half of #72 (UI/streaming) — folds into #102; this lands the exec primitive safely.

## Definition of Done (72)
go + app + orchestrator suites green; tsc. Sandbox `POST /exec` runs a command in a clone (default-deny via `ACP_ALLOW_EXEC`, bounded) returning output+exitCode; the admin app route invokes it org-scoped (non-admin 403, cross-org 404, no-token 400). Interactive PTY UI documented as the follow-up.
