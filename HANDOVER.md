# Session Handover

**Last updated:** 2026-06-03
**Purpose:** Let a fresh Claude Code session resume work with zero prior context.

---

## TL;DR — where we are

Building **agent-chat-platform**: a chat-driven AI agent execution platform (Slack-for-AI-agents
fused with conductor.build-style sandboxed execution → GitHub PRs). **The full roadmap + frontend are COMPLETE and merged** (32 PRs). Plan 1, the chat→fusion loop, the real Claude Code agent, K8s isolation, Stripe billing, and Honeycomb traces are all **live-proven**.

- **Repo:** https://github.com/gagan114662/agent-chat-platform (private, owner `gagan114662`)
- **Local path:** `/Users/gaganarora/Desktop/my projects/agent-chat-platform`
- **`main` — all green:** Go (3 pkgs build/vet/test), orchestrator **31**, app **57**, web **30**, all tsc clean, web build ok.
- **No open PRs.** PRs #1–#32 merged. Beyond the table below: #14 real Claude Code adapter (live), #15 merge-policy gate (4b), #16 K8s namespace-per-org (live on OrbStack), #25 Stripe metering (live test-mode), #30 OTLP→Honeycomb (live, acp-app dataset), #31 app restyle, #32 landing site, #24 verification skills.

### Shipped (all merged to `main`)
| PR | Plan | What |
|---|---|---|
| #1 | 1 | Fusion engine walking skeleton (intent→sandbox→agent→PR→auto-merge), **live-proven** |
| #2/#3 | 2.0a/b | Chat+Tasks backend (mention→fusion→thread, agents-as-principals) + React UI |
| #4 | 2.1a | Channels & threads navigation |
| #5 | 2.1b | Channel creation, thread ordering, message search |
| #6 | 2.1c | Direct messages |
| #7 | 2.2a | Session-based auth (opaque tokens, login gate) |
| #8 | 2.2b | RBAC (member roles, admin-only channel creation) |
| #9 | 2.2c | Auth lockdown (`AUTH_REQUIRE_SESSION` enforcement, WS auth, password login) |
| #10 | 3a | Sandbox-runner hardening (credential redaction, input validation, timeouts, ctx, graceful shutdown) |
| #11 | 4a | Risk router + merge-policy engine + QA-for-UI gate (orchestrator core) |
| #12 | 5 | Open adapter SDK + registry |
| #13 | 6 | OpenTelemetry tracing for the fusion run |

### Remaining (genuinely not yet built)
Most of the old infra-bound list is now DONE & live (K8s #16, OTLP→Honeycomb #30, billing #25, real agent #14, 4b gate #15, sandbox hardening #10). Still open:
- **Postgres RLS enforcement** — `FORCE ROW LEVEL SECURITY` keyed on `org_id` requires routing every
  query through an org-scoped GUC transaction; it would break the current query path. Needs its own
  data-layer plan (app-level `org_id` filtering is in place today).
- **Postgres RLS enforcement** (above) — still a cross-cutting data-layer rewrite.
- **gVisor/Kata runtime** — K8s manifests have the RuntimeClass hook; needs the node runtime installed.
- **NATS event backbone + presence** — realtime uses Postgres `LISTEN/NOTIFY` today.
- **Real OAuth/SSO** — needs an external IdP (password login + opaque sessions are built).
- **Metrics + dashboards** — traces export to Honeycomb; a MeterProvider + dashboards are next.
- **Feature backlog** — GitHub issues #17–#29 (diff viewer, CI fix-on-red, PR-comment sync, plan-mode,
  multi-agent coordination, **memory/context graph**, …); see `docs/BACKLOG.md`.

To run the whole stack live: `services/app/README.md` (Postgres + Temporal + sandbox-runner) + `cd services/web && pnpm dev`. Set `AUTH_REQUIRE_SESSION=true` (with seeded passwords) for enforced auth.

### Plan 2.1c — BUILT ✅ (PR #6)
- Schema (migration `0002_messy_the_hand.sql`): `threads.channelId` nullable + `kind`/`dmPeerKind`/`dmPeerId`.
- Backend `dm` module (`listPrincipals` excl. self, `getOrCreateDm` idempotent, `listDms`) + routes
  (`GET /principals`, `GET /dms`, `POST /dms`). UI: Direct Messages sidebar section + `NewDmPicker`.
- **Verified:** app 40/40, web 23/23, build clean. DMs are pure chat (no repo → no fusion); one dev user.

### Plan 2.1b — BUILT ✅ (PR #5)
- Schema: `threads.createdAt` (migration `0001_special_malice.sql`), `listThreads` newest-first.
- Backend: `createChannel` + `searchMessages` modules; `POST /channels`, `GET /search?q=` routes.
- UI: `SearchBar` (header, jump-to-thread), channel-create in `Sidebar`, `App` wiring.
- **Verified:** app 34/34, web 19/19, build clean, migration applied (prior suites still green).

### Plan 2.1a — BUILT ✅ (PR #4)
- Backend `nav` module + routes (`GET /channels`, `GET /channels/:id/threads`, `POST .../threads`,
  `GET /repos`; dev-auth `actor` extracted to `src/http/actor.ts`). UI: data-driven `Sidebar` +
  `NewThreadForm`; `App` fetches nav + holds `activeThreadId` (switching re-subscribes the WS stream).
- **Verified:** app 27/27 (19 prior + 8 new), web 15/15, build clean. Additive; no schema change.

### Plan 2.0b — BUILT ✅ (PR #3)
- `services/web` (`@acp/web`): React + Vite + TS + Tailwind v4. Renders the thread, posts messages, and
  streams the agent's live step events + final PR card via `useThreadStream` (REST history + WS, dedupe
  by id). Components: `MessageItem` (chat/system/pr_card), `Composer`, `ThreadView`, `Sidebar`, `App`.
- **Verified:** `pnpm test` 7/7 (component+hook, `fetch`/`WebSocket` stubbed), `pnpm build` clean, and a
  screenshot of the rendered shell confirmed the Tailwind layout. Additive (backend untouched).
- Static nav + seeded thread id for now; navigation/auth deferred to 2.1/2.2.

### Plan 2.0a — BUILT ✅ (in review)
- 13 tasks implemented via subagent-driven dev (spec on risky tasks + code-quality review); see
  `docs/specs/2026-06-03-plan-2.0-chat-tasks-design.md` and `docs/plans/2026-06-03-plan-2.0a-chat-tasks-backend.md`.
- New package `services/app` (`@acp/app`): Fastify HTTP+WS, Drizzle/Postgres, in-process Temporal
  worker reusing Plan-1's `runFusion` (now with an optional `onEvent` step-event hook). `POST
  /threads/:id/messages` with an `@mention` → Task+Run → `chatFusionWorkflow` → live events stream to
  the thread (WS via Postgres `LISTEN/NOTIFY`) → `pr_card`. Agents are first-class principals.
- **Verified:** orchestrator 14/14, app 19/19 (unit+integration, incl. a real time-skipping Temporal
  run driving workflow→sink→pr_card→task-done), e2e gate skips cleanly, Go suite clean, all tsc clean.
- **NOT yet live-run as one combined flow:** the env-gated `chat-fusion.e2e.test.ts` needs a **real
  Temporal server** (`TEMPORAL_ADDRESS`) + sandbox-runner + the fixture repo + `E2E_*`. This sandbox
  had no Docker daemon (Colima VM won't boot) and no `temporal` CLI, so it wasn't run here. To run:
  start Postgres (native, already configured) + `temporal server start-dev` (or compose) + the Go
  sandbox-runner, `pnpm db:migrate && pnpm db:seed`, then `pnpm test:e2e` (see `services/app/README.md`).
- **Deferred to 2.0b/2.1+:** React UI (2.0b), DMs/admin/task-board (2.1), SSO/RBAC (2.2),
  NATS/presence/RLS-enforcement/K8s (2.3), real agents. Plan-1 deferred hardening still tracked below.

### Plan 1 — DONE ✅ (live-proven)
- All Tasks 0–7 implemented, each passed spec-compliance + code-quality review.
- PR #1 (`plan-1-fusion-engine` → `main`) **merged**.
- **Live e2e proven:** ran against a real throwaway fixture repo
  (`gagan114662/acp-e2e-fixture`) with the sandbox-runner on `:8090`. Outcome = **`merged`** —
  the agent opened and auto-merged a real PR; `AGENT_CHANGES.md` landed on the fixture's `main`.
- **Integration truth discovered during the live run:** the orchestrator's `getChecksStatus`
  uses `getCombinedStatusForRef` = the *legacy commit-status API*, which does NOT include GitHub
  Actions check-runs. To go green, the fixture repo has a workflow (`.github/workflows/green.yml`)
  that POSTs a success **commit status** (context `e2e/always-green`) on push. Re-running the e2e
  needs that fixture + the `E2E_*` env vars (see `docs/plans/e2e-setup.md`).

---

### Frontend (reload.chat parity) — DONE ✅
- **App UI restyled** to the reload.chat brand (Inter, lavender `#f0f0f7`, near-black `#15151f` accents, rounded surfaces) — PR #31.
- **Marketing landing site** `services/landing` (`@acp/landing`, Vite+React+Tailwind+framer-motion) recreating the full reload.chat experience: intro loader, announcement banner, "Team Chat For AI Agents." hero, scroll-driven pinned app-window reveal w/ scripted agent thread, 4 numbered scroll-synced feature cards (agent pools, tasks board, context-memory graph, approvals, decision capture), black interstitial, FAQ accordion, contact form, footer, floating dock — PR #32. 16 tests, build clean. Run: `cd services/landing && pnpm dev`. Brand placeholder = "Convene"; funding banner is a placeholder (no fabricated figure).
- Polish follow-up: framer-motion logs a "container non-static position" warning on the scroll-reveal target (cosmetic; add `relative` to that container).

## Key documents (read these first)

| Doc | Path | What it is |
|---|---|---|
| Design spec | `docs/specs/2026-06-03-agent-chat-fusion-design.md` | ✅ Complete, 6 sections approved |
| OSS accelerators | `docs/oss-build-accelerators.md` | Open-source components to adopt per subsystem |
| Implementation plan | `docs/plans/2026-06-03-plan-1-fusion-engine.md` | Full TDD plan for Plan 1 (8 tasks: Task 0–7) |
| README | `README.md` | Product thesis + locked decisions |

---

## Locked product decisions (do not re-litigate)

- **Wedge:** the fusion — chat → sandboxed agent execution → GitHub PR → review → merge.
- **Deployment:** team, hosted multi-tenant SaaS.
- **Execution:** cloud sandboxes we host (ephemeral, isolated).
- **Agents:** multi-agent, pluggable adapter; **open adapter SDK + registry from day one**.
- **Output/VCS:** GitHub PRs.
- **Build strategy:** Approach C — full-control Kubernetes platform (documented as steepest path;
  mitigation = build the thin vertical slice first, which is Plan 1).
- **Merge policy:** auto-merge by default ("autopilot"), Agent-Merge-style CI resolution loop,
  mandatory QA-for-UI, human gate = GitHub branch-protection/CODEOWNERS (Layer A) + safety
  tripwires (Layer B), per-repo configurable, shadow mode for new tenants.
- **Tenant isolation:** namespace-per-org + Postgres RLS (cluster-per-org = later premium tier).
- **Tech stack:** polyglot — **TypeScript** (orchestrator/app) + **Go** (sandbox runner/operator).

---

## Plan 1 roadmap & status (subagent-driven execution)

Plan 1 = the walking skeleton: intent → sandbox → fake agent → branch → PR → drive CI → auto-merge.

| Task | Description | Status | Commit |
|---|---|---|---|
| Task 0 | Monorepo scaffolding (pnpm + go workspaces) | ✅ DONE | `2a385d5` |
| Task 1 | Go sandbox-runner — git clone | ✅ DONE | `e8395db` |
| Task 2 | Go Agent interface + FakeAgent + commit/push | ✅ DONE | `5f9f006` |
| Task 3 | Go Run() + HTTP /run endpoint + server | ✅ DONE + reviewed | `d7a16a8` |
| Task 4 | TS orchestrator: package + types + GitHub service (Octokit) | ✅ DONE + reviewed | `a6749f9`, `420793c` |
| Task 5 | TS sandbox client + core fusion (auto-merge on green) | ✅ DONE + reviewed | `798fb19`, `0b57e5d` |
| Task 6 | TS Temporal workflow + activities | ✅ DONE + reviewed | `4be71d3`, `ea332a8` |
| Task 7 | E2E integration test (env-gated, real GitHub) | ✅ DONE + reviewed | `244bd9c`, `0f82479` |

**The Go sandbox-runner service (Tasks 1–3) is complete and fully tested** (5 Go tests pass,
`go build`/`go vet` clean). Each completed task passed a spec-compliance review AND a
code-quality review before being marked done.

---

## Resume here (exact next step)

**All Plan 1 tasks (0–7) are implemented and passed BOTH reviews (spec compliance + code
quality).** Task 4's review gap was closed: it passed spec review, and a code-quality review
drove a refactor (`420793c`) that extracted the fetch shim to `src/http/node-fetch.ts`, added
abort/timeout handling, and validated the merge result. Tasks 5–7 were executed via
subagent-driven-development with the same two-stage review.

Current true state:
- `cd services/orchestrator && pnpm test` → **13/13 green** (unit; e2e excluded).
- `pnpm test:e2e` (no env) → e2e suite **skips cleanly, exit 0**.
- `pnpm exec tsc --noEmit -p tsconfig.json` → clean.
- `cd services/sandbox-runner && go test ./... && go vet ./... && go build ./...` → all clean.

**Status:** the final whole-implementation review passed ("Ready to open PR" — cross-seam
contracts all coherent, all suites green), and a PR is open:
**https://github.com/gagan114662/agent-chat-platform/pull/1** (`plan-1-fusion-engine` → `main`).

**Remaining for a future session:**
- Review/merge PR #1.
- The real e2e (Task 7) has never been run against live GitHub — it needs the `E2E_*` env vars +
  a fixture repo + a running sandbox-runner (see `docs/plans/e2e-setup.md`). Running it is the
  true proof of the Definition of Done (a real auto-merged PR created by the agent).
- Then begin Plan 2 (chat + tasks + agents-as-principals).

Reviewer/implementer prompt templates live in:
`~/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/subagent-driven-development/`

---

## Environment notes (important gotchas)

- **Toolchain present:** node v25.8.2, pnpm 10.28.2, go 1.25.6, docker 29.5.0.
- **`just` is NOT installed.** The repo has a `justfile`, but run tests with raw commands:
  - Go: `cd services/sandbox-runner && go test ./...`
  - TS: `cd services/orchestrator && pnpm test`
- **`go.work` was bumped from 1.22 → 1.25.6** to match the installed Go toolchain.
- **`package.json` packageManager pinned to `pnpm@10.28.2`** (was 9.0.0 in the plan; aligned to
  installed version to avoid Corepack fetching a different release).
- **Git commits:** committed manually with explicit identity
  `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"` (this is a standalone repo,
  not under the user's GitButler setup).
- Subagents commit their own work on the `plan-1-fusion-engine` branch.

---

## Deferred items flagged during review (for Plan 3 hardening, NOT Plan 1)

- Input validation on `RunRequest` (RepoURL/branch) before shelling to git.
- HTTP server `ReadTimeout`/`WriteTimeout` + graceful shutdown in `cmd/server/main.go`.
- `DisallowUnknownFields()` on the JSON decoder.
- `context.Context` threading into git operations (currently accepted but unused in `Run()`).
- Empty-branch/message guards in `CommitAllAndPush`.
- **Secret leak (flagged in Task 7 review):** the sandbox-runner echoes the (token-bearing)
  `RepoURL` in clone-failure errors — `git.go` wraps `args`+git output into the error, `http.go`
  writes `err.Error()` to the HTTP response, and the orchestrator client folds that into its
  thrown error. The e2e test feeds a `https://x-access-token:<PAT>@github.com/...` URL, so a
  clone failure during e2e would print the PAT in test output/logs. Sanitize credentials out of
  URLs before including them in any error/log.

---

## Future plans (after Plan 1)

2. Chat + Tasks + agents-as-principals
3. Multi-tenancy + K8s namespace isolation + gVisor/Kata sandboxes (+ Plan 1 deferred hardening)
4. Risk router + QA-for-UI gate + merge policy engine
5. Adapter SDK + registry
6. Observability, dashboards, billing/metering

Each gets its own spec → plan → subagent-driven execution cycle.
