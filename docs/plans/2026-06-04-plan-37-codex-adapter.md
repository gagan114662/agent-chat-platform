# Plan 37 — Codex adapter (second first-party agent) (#63)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD (Go).

**Design (author's call):** conductor 0.18/0.43 — a second first-party agent. Add a `CodexAdapter` alongside `ClaudeCodeAdapter`, conforming to the same Adapter SDK (Identify/Prepare/Run/ApplyFeedback/Plan/Teardown), registered in `DefaultRegistry` under `"codex"`, default-deny via #38 (must be in `ACP_ALLOWED_ADAPTERS`). It reuses the same hardening as claude-code (repo-config quarantine #49, env-scrub, built-in skills #48, prompt bound, model/provider #58) via the shared helpers, and invokes the `codex` CLI through an **injectable exec** (so tests need no real binary).

**Branch** `plan-37-codex-adapter` (off `main`). Go in `services/sandbox-runner`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: `CodexAdapter`

**Files:** Create `services/sandbox-runner/adapter/codex.go`, `codex_test.go`; Modify `adapter/default.go`
- [ ] **Step 1 — read `adapter/claude_code.go` first** and mirror its structure (the injectable `exec`/`planExec` fields, `lookPath`, the shared `runAgent` helper for quarantine + `provisionBuiltinSkills` + `filterChildEnv` + prompt bound + model/provider). `codex.go`:
  - `CodexAdapter` struct with `lookPath`, `exec`, `planExec` (same signatures as claude's).
  - `NewCodexAdapter()` → real `runCodexCLI`/`runCodexPlanCLI`.
  - `Identify()` → `Identity{Name:"codex", Version:"cli", Capabilities:[]Capability{CanEditCode, CanRunTests}}`.
  - `Prepare()` → `lookPath("codex")` (error if absent); capture repoDir/model/provider like claude.
  - `Run`/`ApplyFeedback`/`Plan`/`Teardown` → delegate to the SAME shared `runAgent`/quarantine/skills path claude uses (extract/share the helper if it's currently private to claude_code.go — make it package-level so both adapters call it). The only difference is the CLI argv builder.
  - `runCodexCLI(ctx, dir, prompt, model, provider, onLine)`: `codex exec <prompt>` (best-effort real invocation; codex's non-interactive subcommand), `--model <model>` when set, provider env mapped the same way; stream stdout/stderr lines to `onLine`. (No real `codex` binary in tests — the injectable `exec` covers behavior.)
- [ ] **Step 2 — `default.go`:** register `"codex"`: `_ = r.Register("codex", func() Adapter { return NewCodexAdapter() })`.
- [ ] **Step 3 — `codex_test.go`** (mirror the claude tests via the injectable exec): `Run` quarantines repo config + injects built-in skills (present during exec, gone after) + rejects oversize prompt (exec not called) + passes model when set; `Identify()` name is `codex`; `DefaultRegistry().Get("codex")` returns it. Confirm `adapterAuthorized("codex")` is false without the allowlist (it's not `fake`) and true with `ACP_ALLOWED_ADAPTERS=codex` (the #38 gate already covers any non-fake name — just assert it).
- [ ] **Step 4:** `cd services/sandbox-runner && go build ./... && go vet ./... && go test ./... 2>&1 | tail -8`. Commit `feat(sandbox): Codex adapter (second first-party agent, #63)`.

---

## Self-Review
- Delivers #63: a real second adapter conforming to the SDK + registry, default-deny authorized (#38), reusing all the claude-code hardening (quarantine/skills/env-scrub/prompt-bound/model-provider) via shared helpers — only the CLI argv differs. Tested via the injectable exec (no real `codex` needed).
- Backward-compat: additive (new adapter + one registry line); the shared `runAgent` helper, if promoted from private-to-claude to package-level, keeps claude's behavior identical (its tests stay green). `fake`/`claude-code` unaffected.
- Note: the exact `codex` CLI flags are best-effort (mirrors how the claude adapter wraps its CLI); refine when wiring a live codex. The platform can now select `codex` per agent via `agents.config` (#58) + the allowlist (#38).

## Definition of Done (63)
go build/vet/test green incl. the codex adapter tests. `codex` is registered, SDK-conformant, default-deny authorized, and reuses the quarantine/skills/env-scrub/model hardening; claude-code + fake unchanged.
