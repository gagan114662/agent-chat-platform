# Design Spec — Chat-Driven AI Agent Execution Platform

**Status:** 🟡 Living document — design in progress
**Date:** 2026-06-03
**Source of truth:** this repo

---

## 1. Problem & wedge

Two adjacent products exist: **reload.chat** ("Slack for AI agents" — channels, threads,
mentions, tasks, memory; comms only) and **conductor.build** (parallel coding agents in
isolated git worktrees with diff/review/merge; execution only). Neither closes the loop
between *coordinating* agents and *executing* their work.

**Our wedge — the fusion seam:** in a chat thread, `@mention` an agent → it executes in an
isolated cloud sandbox against a real repo → produces a **GitHub PR** → the diff + checks are
reviewed in the same thread → merge. Chat → execution → PR, one surface.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Core wedge | The fusion (chat-driven execution) |
| Deployment | Team, hosted multi-tenant SaaS |
| Execution substrate | Cloud sandboxes we host (ephemeral, isolated) |
| Agent support | Multi-agent, pluggable adapter |
| Output / VCS | GitHub PRs |
| Build strategy | C — full-control Kubernetes platform |

## 3. Risk & mitigation (Approach C)

Full-control K8s is the steepest path: months to first usable product; platform-grade infra
(cluster ops, isolation runtime, self-hosted realtime, authz) needed before demand is
validated. **Mitigation:** build a thin vertical slice first — one tenant, one repo, one
agent, mention→sandbox→PR — before horizontal scale-out.

## 4. System architecture (Section 1 — APPROVED)

Services on Kubernetes behind an API gateway; events over self-hosted NATS.

**Core components:**
1. **Web UI** — chat + in-thread diff/PR review + admin dashboards
2. **API Gateway / BFF** — auth, routing, websocket fan-in
3. **Chat Service** — channels, threads, DMs, @mentions, message persistence
4. **Task Service** — Linear-style task lifecycle, assignment, hand-offs
5. **Orchestrator** — the fusion brain; mention→run→PR state machine
6. **Sandbox Controller** — K8s operator spawning isolated agent pods (gVisor/Kata,
   worktree volume, egress + cost/time caps)
7. **Agent Adapter layer** — pluggable interface so any CLI agent runs in a sandbox
8. **GitHub Service** — GitHub App: clone, branch, PR, checks, webhooks → threads
9. **Identity / Tenancy** — orgs, human + agent identities, RBAC, SSO

**Shared infra:** Postgres · Redis · NATS · object storage · secrets · OpenTelemetry.

See [`../oss-build-accelerators.md`](../oss-build-accelerators.md) for the OSS adopted per
component.

## 5. The fusion flow (Section 2 — PENDING)
_To be designed: exact state machine from @mention to merged PR, including failure/retry,
human approval gates, and how results stream back into the thread._

## 6. Data model & multi-tenancy (Section 3 — PENDING)

## 7. Agent adapter interface (Section 4 — PENDING)

## 8. Sandbox isolation, security & cost controls (Section 5 — PENDING)

## 9. Error handling, observability & testing strategy (Section 6 — PENDING)
