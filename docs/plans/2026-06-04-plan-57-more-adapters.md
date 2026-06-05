# Plan 57 — More agent adapters + avatar/visibility (#91)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** reload.chat connects Cursor/Devin/Openclaw/Hermes in addition to Claude/Codex. Add them as first-party adapters via a small **generic CLI-adapter factory** (they all wrap a CLI through the shared `runAgentShared`/`planShared` helpers — quarantine #49, skills #48, env-scrub, prompt-bound, model/provider #58, MCP #57 — differing only in binary + argv + Identify name), registered in `DefaultRegistry`, default-deny authorized (#38). Plus agent **avatar + visibility (public|private)** columns. Exact CLI flags are best-effort (like Codex) and refined when wiring a live tool; the injectable exec covers behavior in tests.

**Branch** `plan-57-more-adapters` (off `main`). Go in `services/sandbox-runner`; small app migration. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: generic CLI adapter + Cursor/Devin/Openclaw/Hermes (Go)

**Files:** Create `services/sandbox-runner/adapter/cli_adapter.go`, `cli_adapter_test.go`; Modify `adapter/default.go`
- [ ] **Step 1 — read `adapter/codex.go`** (the shared-helper pattern from #63). Create `cli_adapter.go`: a `CLIAdapter` struct parameterized by `{ name string; binary string; buildArgs func(prompt, model string) []string }`, with injectable `lookPath`/`exec`/`planExec` defaulting to a real exec that runs `binary` with `buildArgs`. Its `Run`/`Plan`/`ApplyFeedback` delegate to the SAME shared `runAgentShared`/`planShared` (so all hardening applies); `Identify().Name = name`. `newCLIAdapter(name, binary, buildArgs)` constructor.
- [ ] **Step 2 — register** in `default.go`: `cursor` (binary `cursor-agent`, argv best-effort), `devin` (`devin`), `openclaw` (`openclaw`), `hermes` (`hermes`) — each `r.Register(name, func() Adapter { return newCLIAdapter(name, binary, argvFn) })`. (Keep `fake`/`claude-code`/`codex`.)
- [ ] **Step 3 — test (`cli_adapter_test.go`):** for `cursor` (representative): via the injectable exec, `Run` quarantines repo config + injects built-in skills (present during exec, gone after) + rejects oversize prompt (exec not called) + passes model when set; `Identify().Name=="cursor"`; `DefaultRegistry().Get("cursor")`/`devin`/`openclaw`/`hermes` all resolve; `adapterAuthorized("cursor")` false without `ACP_ALLOWED_ADAPTERS`, true with it (#38). `go build/vet/test ./...`. Commit `feat(sandbox): Cursor/Devin/Openclaw/Hermes adapters via a generic CLI factory (#91)`.

## Task 1: agent avatar + visibility (App)

**Files:** `services/app/src/db/schema.ts` + next migration (`0025_agent_avatar_visibility.sql`), `src/agents/agents.ts`, `src/http/agent-routes.ts` (extend), tests
- [ ] **Step 1 — schema/migration:** add to `agents`: `avatarUrl` (text nullable), `visibility` (text default `"public"` — `public|private`). `pnpm db:migrate`.
- [ ] **Step 2 — `agents.ts` + route:** `setAgentProfile(db, { orgId, agentId, avatarUrl?, visibility? })` (org-scoped, validate visibility). Extend `agent-routes.ts` with `PATCH /agents/:id/profile { avatarUrl?, visibility? }` (admin or owner — reuse the existing agent-route gate) + ensure `GET /agents` (if it exists; else add a list) returns avatarUrl/visibility. `resolveMention` should still find public agents; **private** agents resolvable only within their workspace (extend the existing `isPermittedOnRepo`/resolve logic minimally — or note private-visibility enforcement as the follow-up if it widens scope; at minimum store + expose the field).
- [ ] **Step 3 — test:** `PATCH /agents/:id/profile` sets avatar+visibility (invalid visibility → 400; cross-org → 404); the agent list/get reflects it. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): agent avatar + visibility (#91)`.

---

## Self-Review
- Delivers #91: four more first-party adapters (cursor/devin/openclaw/hermes) via a DRY CLI factory reusing ALL the existing hardening, default-deny authorized + selectable per agent (#58); agents gain avatar + visibility.
- Backward-compat: additive adapters (registry only) + nullable/defaulted agent columns; the shared helpers keep claude/codex behavior identical; `fake` always allowed. Migration additive. Existing suites green.
- Note: real per-tool CLI flags + auth + full private-visibility enforcement (resolveMention scoping) are follow-ups; this delivers the adapter set + profile fields.

## Definition of Done (91)
go + app suites green; tsc; migration applies. cursor/devin/openclaw/hermes are registered, SDK-conformant, default-deny authorized, reuse the quarantine/skills/env-scrub/model hardening; agents have avatar + visibility (validated, org-scoped). claude/codex/fake unchanged.
