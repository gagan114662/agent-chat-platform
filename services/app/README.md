# @acp/app — chat + tasks backend (Plan 2.0a)

## Run the stack
1. `cd services/app && docker compose up -d postgres temporal sandbox-runner`
2. `DATABASE_URL=postgres://acp:acp@localhost:5432/acp pnpm db:migrate`
3. `DATABASE_URL=... pnpm db:seed` (seeds one org/workspace/channel/thread + @coder + the fixture repo)
4. `E2E_GITHUB_TOKEN=<PAT> SANDBOX_URL=http://localhost:8090 TEMPORAL_ADDRESS=localhost:7233 DATABASE_URL=... pnpm dev`
5. Post a mention:
   `curl -XPOST localhost:8080/threads/t1/messages -H 'content-type: application/json' -H 'x-org-id: o1' -H 'x-user-id: m1' -d '{"body":"@coder e2e: append agent changes file"}'`
   Watch live events: `websocat 'ws://localhost:8080/ws?threadId=t1'`

## Tests
- Unit/integration: `pnpm test` (needs Postgres at `DATABASE_URL`; Temporal tests use the time-skipping server).
- Real e2e (opt-in): set `E2E_GITHUB_TOKEN`, `E2E_REPO_OWNER`, `E2E_REPO_NAME`, `DATABASE_URL`, `TEMPORAL_ADDRESS`, `SANDBOX_URL`, then `pnpm test:e2e`. Skipped without env.
