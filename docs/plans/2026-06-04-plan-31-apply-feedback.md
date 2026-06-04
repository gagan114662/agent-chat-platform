# Plan 31 — Implement ClaudeCodeAdapter.ApplyFeedback (#66)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD (Go).

**Design (author's call):** the stub audit found `ClaudeCodeAdapter.ApplyFeedback` is a no-op (emits two events, returns nil, never runs `claude`). So with the real agent the CI fix-on-red loop (#18) and PR-comment/feedback path (#19) make no code change. Fix: make `ApplyFeedback` actually run the agent with the feedback `notes` as the prompt — essentially `Run` with the notes — reusing the Plan-24 hardening (prompt bound + repo-config quarantine + env-scrub) and Plan-29 built-in skills, streaming events.

**Branch** `plan-31-apply-feedback` (off `main`). Go in `services/sandbox-runner`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: real `ApplyFeedback`

**Files:** `services/sandbox-runner/adapter/claude_code.go`, `claude_code_test.go`
- [ ] **Step 1:** `ApplyFeedback` currently has no `repoDir` — check the `Adapter` interface signature (`ApplyFeedback(ctx, notes, emit)`); the feedback flow clones into a workdir and the bridge/`AsAgent` path runs the adapter against that dir. Determine how the feedback path passes the repo dir to the adapter (read `internal/sandbox/feedback.go` — it calls `ad.ApplyFeedback(ctx, req.Notes, noopEmit)` after cloning into `req.WorkDir`). **The adapter needs the repo dir.** Two clean options — pick the one matching the codebase:
  - (a) If `ApplyFeedback` has no dir param, add the working dir to the adapter before the call (feedback.go sets it), OR
  - (b) extend the path so `ApplyFeedback` receives the dir like `Run` does.
  Prefer the smallest change that gives `ApplyFeedback` the cloned repo dir. (If `Run` gets `repoDir` and `ApplyFeedback` doesn't, mirror `Run`'s wiring — e.g. store the prepared `RepoDir` from `Prepare`/a field, or change the interface + the one caller in feedback.go.)
- [ ] **Step 2:** implement: bound `notes` by `maxPromptBytes()` (reject if over); quarantine repo config (defer restore); provision built-in skills (defer cleanup); run `a.exec(ctx, repoDir, notes, onLine)` (same `claude -p <notes> --permission-mode acceptEdits` path as `Run`, streaming each line as an `EventLog`); emit start/done events. Reuse the exact `Run` body with `notes` as the prompt (extract a shared private helper `runAgent(ctx, repoDir, prompt, emit)` that both `Run` and `ApplyFeedback` call — DRY).
- [ ] **Step 3 — test (`claude_code_test.go`):** using the injectable `exec`, `ApplyFeedback` against a temp repoDir with a `CLAUDE.md`: the injected exec is CALLED with the notes as the prompt and observes the repo's `CLAUDE.md` quarantined + a built-in skill present during the call; oversize notes → error + exec NOT called; after return the tree is clean (skills removed, CLAUDE.md restored). Keep existing adapter tests green. `go build/vet/test ./... 2>&1 | tail -6`. Commit `feat(sandbox): implement ClaudeCodeAdapter.ApplyFeedback (real agent feedback) (#66)`.

---

## Self-Review
- Closes #66: the real claude-code agent now applies feedback (runs with the notes as the prompt), so the CI fix-on-red loop (#18) and PR-comment feedback (#19) do real work with the real agent — not just the fake. Reuses the same hardening as `Run` (quarantine, env-scrub, prompt bound, built-in skills) via a shared helper.
- Backward-compat: signature change (if needed) is internal to the sandbox-runner — update the one caller in `feedback.go`; `FakeAdapter.ApplyFeedback` (which already writes `FEEDBACK.md`) is unaffected; existing tests stay green.

## Definition of Done (66)
go build/vet/test green. `ClaudeCodeAdapter.ApplyFeedback` runs the agent with the feedback notes against the cloned repo dir (quarantined + skill-provisioned + bounded), producing a real change; oversize notes rejected; tree clean after. No more no-op.
