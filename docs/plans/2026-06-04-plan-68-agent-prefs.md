# Plan 68 — Agent preferences / custom prompts / context dirs (#74)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** conductor 0.28/0.29.1/0.31.2/0.57 — per-agent **custom system prompt**, **context directories**, and **preferences**, synced via `agents.config`. The agent's `systemPrompt` + a `contextDirs` hint are prepended to the run intent (alongside recalled memory #26), so each agent runs with its configured persona/scope. A route sets these on `agents.config`.

**Branch** `plan-68-agent-prefs` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: read prefs + build them into the intent

**Files:** `services/app/src/agents/agents.ts` (extend `agentModelConfig` or add `agentPrefs`), `src/fusion/activities.ts` (`buildAgentIntent`), tests
- [ ] **Step 1 — `agents.ts`:** `agentPrefs(agent): { systemPrompt?: string; contextDirs?: string[]; preferences?: Record<string, unknown> }` reading `agent.config` (jsonb) — only well-typed string/array values.
- [ ] **Step 2 — `buildAgentIntent` (activities.ts, #26):** it currently builds `intent + recalled memory`. Extend to ALSO prepend, when the agent has them: the `systemPrompt` (as a leading "## Instructions" block) and a `contextDirs` hint ("## Focus directories: <dirs>"). Order: systemPrompt → task intent (first line preserved for the PR title #26) → focus dirs → recalled memory. The function already takes `db, orgId, intent`; thread the `agentId` (the activity has it) so it can `agentPrefs(agent)`.
- [ ] **Step 3 — test:** an agent with `config = { systemPrompt: "You are a careful reviewer.", contextDirs: ["src/auth"] }` → `buildAgentIntent` output contains the systemPrompt block + the focus-dirs line + the original task as the first task line; an agent with no prefs → just the task (+ recall). Org-scoped. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): agent system prompt + context dirs in the run intent (#74)`.

## Task 1: route to set agent prefs

**Files:** `services/app/src/http/agent-routes.ts` (extend), test
- [ ] `PATCH /agents/:id/config { systemPrompt?, contextDirs?, preferences? }` → `actor(req)`, admin/owner gate (reuse the `agent:share` gate), org-scoped (404); merge into `agents.config` (preserve existing keys like model/provider/mcpServers); validate `contextDirs` is a string array. Return the agent. Test: PATCH sets the prefs (merged with existing model config not clobbered); invalid contextDirs → 400; cross-org → 404; non-admin → 403. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): PATCH /agents/:id/config — agent preferences (#74)`.

---

## Self-Review
- Delivers #74: per-agent system prompt + context-directory focus + preferences on `agents.config`, woven into the run intent (with the task line preserved for the clean PR title), set via a route. Each agent runs with its persona/scope.
- Backward-compat: prefs optional → no prefs = today's intent; `agentPrefs` merges without clobbering model/provider/mcpServers (#58/#57); org-scoped (#14). No migration (reuses jsonb config). Existing suites green.
- Note: enforcing `contextDirs` as a hard read-scope in the sandbox (vs an intent hint) + a richer preferences schema + a prefs UI (#102) are follow-ups; this delivers the configured-persona threading.

## Definition of Done (74)
app suite green; tsc. An agent's `systemPrompt`/`contextDirs` appear in its run intent (task line preserved); `PATCH /agents/:id/config` sets them without clobbering model config; validated, org-scoped (403/404). No prefs = unchanged.
