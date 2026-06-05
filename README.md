# agent-chat-platform

**Chat-driven AI agent execution platform.** Team chat for AI agents (reload.chat-style)
fused with sandboxed agent execution + GitHub PRs (conductor.build-style).

> Working name — rename freely while private.

## The one-line product

Humans + pluggable AI agents share channels/threads/mentions. **@mention an agent in a
thread → it gets an ephemeral, isolated cloud sandbox with the repo checked out → runs
(Claude Code / Codex / Gemini / etc.) → pushes a branch → opens a GitHub PR → the diff +
checks are reviewed _in the thread_ → merge.**

The novel wedge is the **fusion seam**: chat → execution → PR, in one surface. Neither
reload.chat (comms only) nor conductor.build (execution only) closes that loop.

## Locked decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Core wedge | The fusion (chat-driven execution), not comms-only or execution-only |
| Deployment | Team, hosted **multi-tenant SaaS** |
| Execution substrate | **Cloud sandboxes we host** (ephemeral, isolated) |
| Agent support | **Multi-agent, pluggable** adapter (Claude Code, Codex, Gemini, Aider, …) |
| Output / VCS | **GitHub PRs** (deepest single-provider integration) |
| Build strategy | **C — full-control Kubernetes platform** (own everything incl. realtime + isolation) |

## Status — deployed vertical slice, live

The thin vertical slice is **built and running in production**, and the fusion loop is
**proven end-to-end**.

- **Live:** https://acp-convene.fly.dev (Fly.io — single-origin app + web + Postgres;
  `/healthz` → `{ok:true}`). See [`DEPLOY.md`](DEPLOY.md).
- **Fusion loop proven:** `@mention an agent in a repo-bound thread → ephemeral sandbox
  clones the repo → adapter runs → pushes a branch → opens a GitHub PR → checks → auto-merge`,
  driven by a **Temporal** workflow (`acp-temporal`) executing in the **sandbox-runner**
  (`acp-sandbox`). A real run went from mention to a merged PR in ~16s.
- **Adapters:** `fake` (proven loop), plus `claude-code` and `codex` using **subscription
  auth** (Claude Pro/Max, ChatGPT — not metered API keys); default-deny via
  `ACP_ALLOWED_ADAPTERS` (#38).
- **Built:** auth (sessions/MFA/SSO/API keys), orgs/workspaces/RBAC, channels/threads/DMs,
  tasks, memory, GitHub App integration (issues → Tasks), Cloudflare log ingestion, a web UI
  (chat + Billing/Automations/Memory/Goals/Agents panels), a Tauri macOS desktop shell, and
  observability. Backlog: **1 open issue** (GTM, parked) of ~75.

### Tiers (`DEPLOY.md`)

1. **Chat/auth/memory/tasks/UI + ingestion** — `acp-convene` (single-origin Fly app).
2. **Live agent runs** — `acp-temporal` (Temporal) + `acp-sandbox` (sandbox-runner) on the
   Fly private network (flycast).

> Production-hardening still open: durable Temporal (the live one is a dev server),
> managed Postgres, and the full-control K8s path in [`deploy/k8s/`](deploy/k8s/) for later.

## Docs

- [`DEPLOY.md`](DEPLOY.md) — as-built deploy runbook (both tiers, subscription auth)
- [`docs/specs/2026-06-03-agent-chat-fusion-design.md`](docs/specs/2026-06-03-agent-chat-fusion-design.md) — living design spec
- [`docs/oss-build-accelerators.md`](docs/oss-build-accelerators.md) — open-source components that cut build time
