# E2E setup

Required env vars (test is skipped if any are missing):
- `E2E_GITHUB_TOKEN` — PAT with `repo` scope on a throwaway test repo
- `E2E_REPO_OWNER` — e.g. `gagan114662`
- `E2E_REPO_NAME` — e.g. `acp-e2e-fixture` (must exist, have a `main` branch with 1 commit,
  and ideally a trivial always-green GitHub Actions check)
- `E2E_SANDBOX_URL` — e.g. `http://localhost:8090`

Run the sandbox-runner first:
    cd services/sandbox-runner && SANDBOX_ADDR=:8090 go run ./cmd/server

Then: `just e2e`

(`just` is not installed in every environment; the equivalent raw command is
`cd services/orchestrator && pnpm test:e2e`.)
