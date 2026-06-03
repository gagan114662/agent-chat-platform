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

## ⚠️ Documented risk

Approach C (full-control K8s) is the steepest path — realistically **months, not weeks** to
first usable product, and it requires standing up platform-grade infra (cluster ops,
isolation runtime, self-hosted realtime, authz) **before demand is validated**. Mitigation:
sequence the build as a thin vertical slice first (one tenant, one repo, one agent,
mention→sandbox→PR) before scaling out.

## Docs

- [`docs/specs/2026-06-03-agent-chat-fusion-design.md`](docs/specs/2026-06-03-agent-chat-fusion-design.md) — living design spec
- [`docs/oss-build-accelerators.md`](docs/oss-build-accelerators.md) — open-source components that cut build time

## Status

🟡 **Design in progress.** Section 1 (architecture) approved. Sections 2–6 pending.
No application code scaffolded yet.
