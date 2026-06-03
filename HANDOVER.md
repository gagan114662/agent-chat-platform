# Session Handover

**Last updated:** 2026-06-03
**Purpose:** Let a fresh Claude Code session resume work with zero prior context.

---

## TL;DR — where we are

Building **agent-chat-platform**: a chat-driven AI agent execution platform (Slack-for-AI-agents
fused with conductor.build-style sandboxed execution → GitHub PRs). The **design spec is
complete and approved**, and we are **mid-way through executing Plan 1 (the Fusion Engine
walking skeleton)** using subagent-driven development.

- **Repo:** https://github.com/gagan114662/agent-chat-platform (private, owner `gagan114662`)
- **Local path:** `/Users/gaganarora/Desktop/my projects/agent-chat-platform`
- **Working branch:** `plan-1-fusion-engine` (NOT merged to main yet)
- **Next action:** implement **Task 4** of Plan 1 (TypeScript GitHub service). See "Resume here".

---

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
| **Task 4** | **TS orchestrator: package + types + GitHub service (Octokit)** | ⚠️ **IMPLEMENTED + tests green (3/3), but NOT reviewed** | `a6749f9` |
| Task 5 | TS sandbox client + core fusion (auto-merge on green) | ⏳ pending | — |
| Task 6 | TS Temporal workflow + activities | ⏳ pending | — |
| Task 7 | E2E integration test (env-gated, real GitHub) | ⏳ pending | — |

**The Go sandbox-runner service (Tasks 1–3) is complete and fully tested** (5 Go tests pass,
`go build`/`go vet` clean). Each completed task passed a spec-compliance review AND a
code-quality review before being marked done.

---

## Resume here (exact next step)

**FIRST: review Task 4 (already implemented in `a6749f9`, but never reviewed).**
The implementer deviated from the plan: `src/github/octokit-github-service.ts` is ~95 lines
(plan was ~30) because Octokit v21 uses global `fetch` (undici) which `nock` couldn't intercept,
so a **custom-fetch injection workaround** was added. The 3 tests pass (`pnpm test` → 3/3 green).
Before trusting it:
1. Dispatch a **spec-compliance reviewer** for Task 4. Verify: public constructor is still
   `constructor(token: string)`; the test was NOT weakened to pass; `openPr`/`getChecksStatus`/
   `merge` behave per spec; the fetch workaround is sound.
2. Then a **code-quality reviewer** (only after spec passes). Fix issues via the same subagent,
   re-review until approved.
3. Mark Task 4 done.

**THEN: execute Tasks 5 → 6 → 7** from `docs/plans/2026-06-03-plan-1-fusion-engine.md` using
**superpowers:subagent-driven-development**: one implementer subagent per task (full task text,
don't make it read the plan) → spec-compliance review → code-quality review → mark complete.

4. After Task 7: dispatch a final whole-implementation review, then use
   **superpowers:finishing-a-development-branch** (open a PR from `plan-1-fusion-engine`).

> Note on process: Tasks 0–3 were each implemented and passed BOTH reviews. Task 4's code
> landed without my review gates (its dispatch was interrupted), so treat it as unverified
> until the two reviews above pass.

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

---

## Future plans (after Plan 1)

2. Chat + Tasks + agents-as-principals
3. Multi-tenancy + K8s namespace isolation + gVisor/Kata sandboxes (+ Plan 1 deferred hardening)
4. Risk router + QA-for-UI gate + merge policy engine
5. Adapter SDK + registry
6. Observability, dashboards, billing/metering

Each gets its own spec → plan → subagent-driven execution cycle.
