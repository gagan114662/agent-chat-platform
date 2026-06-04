# Plan 22 — drizzle-orm SQLi upgrade + first CI workflow (#52)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps.

**Design (author's call):** the defending-code scan (#52/VF-05) flagged `drizzle-orm < 0.45.2` (SQL-injection advisory, reachable prod DB layer). Upgrade it, prove the suite + migrations still pass, and give the repo its **first CI** — GitHub Actions running every suite + `pnpm audit` + `govulncheck` so this stays continuous (the harness #47 "continuous scanning" step). This also closes the CI half of #47.

**Branch** `plan-22-deps-and-ci` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. pnpm 10.28.2, Node ≥20, Go 1.25. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: upgrade drizzle-orm (+ drizzle-kit) and prove green

**Files:** `services/app/package.json`, `pnpm-lock.yaml`, possibly `services/app/src/db/*` if the API shifted
- [ ] **Step 1:** bump `drizzle-orm` to `^0.45.2` and `drizzle-kit` to a compatible current (`^0.31.0` or whatever pairs with 0.45.x — pick the version drizzle-kit's peer range wants for orm 0.45). Run `pnpm install` from the repo root.
- [ ] **Step 2:** `cd services/app && DATABASE_URL=postgres://acp:acp@localhost:5432/acp pnpm db:migrate` — confirm migrations still apply cleanly against a fresh DB (drop/recreate the `acp` db first if needed). The schema uses `pgTable`, `text`, `timestamp`, `jsonb`, `index`, `primaryKey` — verify none changed signature in 0.45 (fix imports/usages if the build complains).
- [ ] **Step 3:** `DATABASE_URL=… pnpm test 2>&1 | tail -6` (132 tests, stay green) + `pnpm exec tsc --noEmit -p tsconfig.json`. Fix any 0.45 type/API breakages (e.g. `and()`/`eq()` import path, `InferSelectModel`). The orchestrator imports from `@acp/orchestrator` (no direct drizzle) — but run `cd services/orchestrator && pnpm test && pnpm exec tsc --noEmit -p tsconfig.json` to be safe.
- [ ] **Step 4:** `pnpm audit --audit-level=high 2>&1 | tail -20` — confirm the drizzle-orm advisory is gone (other advisories: otel-prometheus is only if `/metrics` is exposed; protobufjs/vitest are dev-only — leave unless trivial). Commit `fix(deps): upgrade drizzle-orm to ^0.45.2 (SQLi advisory, #52)`.

## Task 1: GitHub Actions CI (first workflow for the repo)

**Files:** Create `.github/workflows/ci.yml`
- [ ] **Step 1:** write a workflow triggered on `push` + `pull_request` with these jobs:
  - **go:** `services/sandbox-runner` — set up Go 1.25, `go build ./... && go vet ./... && go test ./...`.
  - **orchestrator:** Node 20 + pnpm 10 (`pnpm/action-setup`), `pnpm install --frozen-lockfile`, `pnpm --filter @acp/orchestrator test` + `tsc --noEmit`.
  - **app:** a `postgres:16` **service** container (env `POSTGRES_USER=acp POSTGRES_PASSWORD=acp POSTGRES_DB=acp`, health-check), Node 20 + pnpm, `pnpm install --frozen-lockfile`, `DATABASE_URL=postgres://acp:acp@localhost:5432/acp pnpm --filter @acp/app db:migrate` then `pnpm --filter @acp/app test` (the vitest config already sets `ACP_ALLOW_DEV_HEADERS=1`) + `tsc --noEmit`.
  - **web:** Node 20 + pnpm, `pnpm --filter @acp/web test && pnpm --filter @acp/web build`.
  - **security-audit:** Node 20 + pnpm → `pnpm audit --audit-level=high` (continue-on-error so advisories surface without blocking the merge initially — comment why); plus Go `govulncheck` (`go install golang.org/x/vuln/cmd/govulncheck@latest && cd services/sandbox-runner && govulncheck ./...`).
  - Use the actual pnpm version from `package.json` `packageManager` (10.28.2) and Node from `engines` (≥20 → use 20).
- [ ] **Step 2:** validate the YAML is well-formed locally: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`. (We can't run Actions locally; this is the lint gate.) Commit `ci: add GitHub Actions (go/orchestrator/app/web + audit + govulncheck) (#52, #47)`.

---

## Self-Review
- Closes #52: drizzle SQLi advisory fixed (upgrade) + a CI that runs all four workspaces, app tests against a real Postgres service, and a continuous security-audit job (`pnpm audit` + `govulncheck`) — the #47 continuous-scan step.
- Backward-compat: drizzle 0.36→0.45 is a minor-version jump; the query builder API (`pgTable`/`eq`/`and`/`select`) is stable — Task 0 fixes any drift and proves it via the existing 132-test suite + migrations. CI is additive (the repo had none).
- Note: the `security-audit` job starts `continue-on-error` so the dev-only protobufjs/vitest advisories don't red-wall every PR; tighten to blocking once those are overridden.

## Definition of Done (52)
app + orchestrator + go + web suites green on the upgraded drizzle-orm; migrations apply; `pnpm audit --audit-level=high` no longer flags drizzle-orm. `.github/workflows/ci.yml` exists, is valid YAML, and defines the go/orchestrator/app(+postgres)/web/security-audit jobs.
