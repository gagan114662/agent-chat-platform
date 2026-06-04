---
name: verify-acp
description: Verify agent-chat-platform changes end-to-end. Run after ANY code change to services/{sandbox-runner,orchestrator,app,web}, before claiming work is done or opening a PR. Encodes the deterministic Definition-of-Done checks for this repo.
---

# verify-acp

Self-verification for this repo. Run the deterministic suites first (cheap, always);
run the live e2e only when the change touches the fusion loop and the stack is up.
**Fix issues and re-run before responding.** Never claim "done" without pasted green output.

## Prereqs (Postgres must be reachable)
The app + nav/dm/auth suites need Postgres at `DATABASE_URL=postgres://acp:acp@localhost:5432/acp`.
It runs natively here (Homebrew `postgresql@16`). If down:
`pg_ctl -D /opt/homebrew/var/postgresql@16 -l /tmp/acp-pg.log -w start` then ensure role/db `acp` exist.
Migrations: `cd services/app && DATABASE_URL=... pnpm db:migrate`.

## Step 1 — Deterministic suites (ALWAYS run; this is the DoD gate)
```bash
cd services/sandbox-runner && go build ./... && go vet ./... && go test ./...
cd services/orchestrator && pnpm test && pnpm exec tsc --noEmit -p tsconfig.json
cd services/app && DATABASE_URL=postgres://acp:acp@localhost:5432/acp pnpm test && pnpm exec tsc --noEmit -p tsconfig.json
cd services/web && pnpm test && pnpm build
```
All four must be green + tsc/build clean. Paste the `Tests N passed` lines and exit codes.

Rules learned in this repo (don't regress):
- ESM everywhere; relative imports use the `.js` suffix.
- DB-backed vitest files run serially (`singleFork`/`fileParallelism:false`) — a shared Postgres.
- Any test that sets `AUTH_REQUIRE_SESSION` MUST clear it in a `try/finally` (env leak → spurious 401s).
- Adding a method to the `GitHubService` interface breaks the `run-fusion.test.ts` fake — add it there too.

## Step 2 — Live fusion e2e (run when the change touches the mention→fusion→PR loop)
Requires Docker (OrbStack) + a real Temporal + the Go sandbox-runner + the throwaway fixture repo
`gagan114662/acp-e2e-fixture` (has a workflow that posts a green commit status).
```bash
# Temporal dev server (real, not auto-setup which needs a DB):
docker run -d --name acp-temporal -p 7233:7233 temporalio/temporal server start-dev --ip 0.0.0.0
# Sandbox-runner (native is simplest):
cd services/sandbox-runner && SANDBOX_ADDR=:8090 go run ./cmd/server &
# Seed + run the env-gated e2e:
cd services/app
export E2E_GITHUB_TOKEN=$(gh auth token) E2E_REPO_OWNER=gagan114662 E2E_REPO_NAME=acp-e2e-fixture
export DATABASE_URL=postgres://acp:acp@localhost:5432/acp TEMPORAL_ADDRESS=localhost:7233 SANDBOX_URL=http://localhost:8090
pnpm db:migrate && pnpm db:seed && pnpm test:e2e
```
Expect `run state: merged`. **Gotcha:** an old re-seed could leave `thread t1` without a `repo_id`
(seed now upserts it). If `startedRuns` is 0, check `select repo_id from threads where id='t1'`.
Always redact tokens in any pasted output (`sed -E 's/(gho_|ghp_|x-access-token:)[A-Za-z0-9_]+/[REDACTED]/g'`).

## Step 3 — Report evidence
Paste the suite pass-counts + (if run) the e2e `run state` and the merged PR number. Do not assert
success without this evidence.
