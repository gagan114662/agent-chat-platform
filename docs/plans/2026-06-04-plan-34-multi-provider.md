# Plan 34 — Multi-provider model config per agent (#58)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** conductor 0.13.6/0.36.2 — pick the model/provider per agent (Anthropic default; Bedrock/Vertex/OpenAI/custom). MVP: store `{ provider?, model? }` on `agents.config` (already jsonb), thread it end-to-end (app → orchestrator → sandbox), and have the claude-code adapter pass `--model` + set the provider env (`CLAUDE_CODE_USE_BEDROCK`/`CLAUDE_CODE_USE_VERTEX`) for the agent process. Default (no config) = today's behavior. Per-provider **credentials** stay deployment env (secrets, never committed); the platform only carries the selection.

**Branch** `plan-34-multi-provider` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Go in `services/sandbox-runner`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: sandbox — model/provider through to the agent

**Files:** `services/sandbox-runner/adapter/adapter.go` (PrepareContext), `internal/sandbox/run.go` (+ `plan.go`, `feedback.go` RunRequest/PlanRequest/FeedbackRequest), `adapter/claude_code.go`, `claude_code_test.go`, `internal/sandbox/http.go` (pass-through)
- [ ] **Step 1 — request fields:** add optional `Model string \`json:"model,omitempty"\`` and `Provider string \`json:"provider,omitempty"\`` to `RunRequest`, `PlanRequest`, `FeedbackRequest`. (Validate() unaffected — they're optional, no shell metachar risk because they're passed as distinct argv/env, but ADD a guard: reject a `Model`/`Provider` containing whitespace or starting with `-` to prevent flag injection.)
- [ ] **Step 2 — PrepareContext:** add `Model string` + `Provider string` to `adapter.PrepareContext`. In `http.go`, when building `PrepareContext` for `/run` `/plan` `/feedback`, pass `req.Model`/`req.Provider`.
- [ ] **Step 3 — adapter:** `ClaudeCodeAdapter` captures `model`/`provider` from `Prepare` (like `repoDir`). In the shared `runAgent`/`runClaudeCLI`: if `model != ""` append `--model`, `model` to the argv; build the child env via `filterChildEnv(os.Environ())` PLUS provider env — `provider=="bedrock"` → `CLAUDE_CODE_USE_BEDROCK=1`, `provider=="vertex"` → `CLAUDE_CODE_USE_VERTEX=1` (others ignored). (Model/provider are validated in Step 1, so safe as argv/env.)
- [ ] **Step 4 — test:** via the injectable `exec`, a `Run` after `Prepare(PrepareContext{Model:"claude-opus-4-8", Provider:"bedrock"})` → the exec/argv includes `--model claude-opus-4-8` (assert by having the fake exec capture the model arg — extend the exec seam to surface it, or assert `runClaudeCLI` builds the right argv via a small unit). Validate() rejects `Model:"-x"` / `Model:"a b"`. No model → no `--model` (default). `go build/vet/test ./...`. Commit `feat(sandbox): per-request model/provider for the agent (#58)`.

## Task 1: orchestrator — thread model/provider

**Files:** `services/orchestrator/src/sandbox/sandbox-runner-client.ts`, `src/core/run-fusion.ts`, fakes/tests
- [ ] **Step 1:** add optional `model?: string; provider?: string` to the `SandboxRunner.run`/`plan`/`feedback` request types + the `SandboxRunnerClient` POST bodies. Add `model?`/`provider?` to `FusionInput`; pass them into `sandbox.run`/`sandbox.plan`/`ciFix→feedback`. Update fakes (they ignore the new optional fields).
- [ ] **Step 2 — test:** a run-fusion test asserting that when `input.model` is set, `sandbox.run` is called with `model` in the request. `pnpm test` + tsc. Commit `feat(orchestrator): thread model/provider into the sandbox run (#58)`.

## Task 2: app — agent config → run

**Files:** `services/app/src/agents/agents.ts` (read config), `src/fusion/start.ts` (+ activities.ts), `start.test.ts`/an app test
- [ ] **Step 1:** define `AgentModelConfig = { provider?: string; model?: string }`; a helper `agentModelConfig(agent): AgentModelConfig` reading `agent.config` (jsonb). `StartFusionRunInput` gains `model?`/`provider?`. The mention handler + reassign + tick resolve the agent and pass `agentModelConfig(agent)` into `startFusionRun`; the activity threads `model`/`provider` into `runFusionTraced`/the sandbox run.
- [ ] **Step 2 — test:** seed an agent with `config = { model: "claude-sonnet-4-6" }`; a started run passes `model: "claude-sonnet-4-6"` to the fake starter/sandbox. An agent with no config → no model (default). `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): per-agent model/provider from agents.config (#58)`.

---

## Self-Review
- Delivers #58 MVP: per-agent model + provider selection (Anthropic default; Bedrock/Vertex via env flags; OpenAI/custom = future provider env), threaded app→orchestrator→sandbox→agent, default unchanged. Model/provider validated (no flag/shell injection) and passed as argv/env.
- Backward-compat: all fields optional; no config → today's behavior; new fields ignored by fakes. Provider credentials are deployment env (secrets), not platform data. Existing suites green.
- Note: full OpenAI/custom-endpoint wiring (base URL, key plumbing) + a UI model-picker (conductor 0.36.2) are follow-ups; this delivers the per-agent selection + claude-CLI model/Bedrock/Vertex path.

## Definition of Done (58)
go + orchestrator + app suites green; tsc. An agent with `config.model` runs the claude CLI with `--model <model>` (and the provider env when set); validation blocks injection; no-config agents are unchanged.
