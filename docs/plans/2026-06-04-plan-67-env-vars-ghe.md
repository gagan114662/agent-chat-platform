# Plan 67 — Per-sandbox env vars + GitHub Enterprise (#73)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** conductor 0.22.4 — per-repo **environment variables** (so the agent/build has needed env) + **GitHub Enterprise** host support. Repo gains `envVars` (jsonb, admin-configured secrets) threaded to the sandbox and applied to the agent's child env (after the #49 scrub — these are intentional repo config), and `githubApiUrl` (GHE base URL) used by the Octokit client. All optional; defaults unchanged.

**Branch** `plan-67-env-vars-ghe` (off `main`). Go in `services/sandbox-runner`; orchestrator + app. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: per-sandbox env vars (Go)

**Files:** `services/sandbox-runner/internal/sandbox/{run,feedback,http}.go`, `adapter/adapter.go` (PrepareContext), `adapter/claude_code.go`/`codex.go`/`cli_adapter.go` (apply), `setup.go` (apply to the setup script too), tests
- [ ] **Step 1 — request field:** add `Env map[string]string \`json:"env,omitempty"\`` to `RunRequest`/`FeedbackRequest`. Add `Env map[string]string` to `adapter.PrepareContext`; `http.go` passes `req.Env`.
- [ ] **Step 2 — apply:** in the shared `runAgentShared`/`runClaudeCLI` env construction, after `filterChildEnv(os.Environ())`, append the repo `Env` (so admin-configured vars are present for the agent — intentional override of the scrub). Also pass `req.Env` to `runSetupScript` (the build needs them) — `runSetupScript` appends them to `cmd.Env`.
- [ ] **Step 3 — test:** a `cli_adapter`/claude test (injectable exec capturing the child env) where `PrepareContext{Env: {"FOO":"bar"}}` → the exec's env contains `FOO=bar`; setup-script test where `Env` is set → the script sees `$FOO`. `go build/vet/test ./...`. Commit `feat(sandbox): per-run env vars for the agent + setup script (#73)`.

## Task 1: GitHub Enterprise base URL (orchestrator)

**Files:** `services/orchestrator/src/github/octokit-github-service.ts`, `octokit-github-service.test.ts`
- [ ] `OctokitGitHubService` constructor gains an optional `baseUrl` → passed to Octokit as `baseUrl` (so GHE hosts work). Default (undefined) → github.com as today. Add a nock test hitting a GHE-style base path. (The clone host for GHE is the repo URL itself — already host-agnostic via `repoUrl`.) `pnpm test` + tsc. Commit `feat(orchestrator): GitHub Enterprise base URL on OctokitGitHubService (#73)`.

## Task 2: repo config + threading (App)

**Files:** `services/app/src/db/schema.ts` + next migration (`0031_repo_env_ghe.sql`), `src/fusion/{start,activities}.ts`, orchestrator client (`sandbox-runner-client` Env field), the activity's GitHub client construction, tests
- [ ] **Step 1 — schema/migration:** add `envVars` (jsonb, default `{}`) + `githubApiUrl` (text nullable) to `repos`. `pnpm db:migrate`.
- [ ] **Step 2 — thread env:** orchestrator `SandboxRunner.run`/`feedback` request types gain `env?: Record<string,string>`; `FusionInput` carries it; the activity reads `repo.envVars` and passes it. Update fakes.
- [ ] **Step 3 — thread GHE:** where the activity builds the GitHub client / orchestrator `runFusion` constructs `OctokitGitHubService(token)`, pass `repo.githubApiUrl` as the baseUrl. (FusionInput already has owner/repo; add `githubApiUrl?`.)
- [ ] **Step 4 — test:** a run for a repo with `envVars={K:V}` passes `env:{K:V}` to the sandbox (fake asserts); a repo with `githubApiUrl` builds the GitHub client with that base (assert via the injected factory). `DATABASE_URL=… pnpm test` (app + orchestrator) + tsc. Commit `feat(app): per-repo envVars + githubApiUrl threaded into the run (#73)`.

---

## Self-Review
- Delivers #73: per-repo env vars reach the agent + the setup script (#71); GHE host support via the Octokit baseUrl. Both admin-configured, optional, threaded app→orchestrator→sandbox.
- Backward-compat: `envVars` default `{}` + `githubApiUrl` nullable → unchanged behavior; env vars applied after the #49 scrub are an intentional admin override; fakes ignore the new fields. Migration additive. Existing suites green.
- Note: env-var encryption-at-rest + a secrets UI + full GHE clone-auth nuances are follow-ups; this delivers the config + threading.

## Definition of Done (73)
go + orchestrator + app suites green; tsc; migration applies. A repo's `envVars` are present in the agent + setup-script env; `githubApiUrl` routes Octokit at a GHE host; both optional, threaded end-to-end; defaults unchanged.
