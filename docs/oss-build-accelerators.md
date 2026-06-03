# Open-Source Build Accelerators

Map of OSS we can adopt (or fork/learn from) per component, so we build the *novel* parts
and rent/borrow the commodity parts. License must be re-verified before adoption.

## Biggest time-savers (adopt these)

| Need | Adopt | Why it saves months | License |
|---|---|---|---|
| **Orchestrator durability** (mention→run→PR state machine, retries, resume) | **Temporal** | Durable workflow engine purpose-built for long-running, crash-resilient orchestration. The fusion brain *is* a workflow. | MIT |
| **Sandbox runtime** (run untrusted agent code in K8s) | **OpenSandbox** (Alibaba) | Apache-2.0, unified API, **Kubernetes runtime** with **gVisor / Kata / Firecracker** — exactly Approach C's isolation needs. | Apache-2.0 |
| **Isolation primitives** | **gVisor**, **Kata Containers**, **Firecracker** | Battle-tested kernel/microVM isolation; OpenSandbox wraps these. | Apache-2.0 |
| **Auth + multi-tenancy + SSO** | **Zitadel** (or **Keycloak**) | Multi-tenant orgs, OIDC, SSO out of the box — don't build identity. | Apache-2.0 |
| **Fine-grained authz (RBAC/ReBAC)** | **OpenFGA** (or **SpiceDB**) | Zanzibar-style permissions for channels/agents/repos scopes. | Apache-2.0 |
| **GitHub App plumbing** | **Octokit** + **Probot** | Official SDK + app framework: clone, branch, PR, checks, webhooks. | MIT |
| **Realtime bus** | **NATS** (JetStream) | Self-hosted pub/sub + streams for chat fan-out and service events. | Apache-2.0 |
| **Secrets** | **OpenBao** (Vault open fork) / **Vault** | Per-tenant tokens (GitHub, agent API keys) handled safely. | MPL-2.0 |
| **Observability** | **OpenTelemetry** + **Grafana/Prometheus/Loki/Tempo** | Traces/metrics/logs across the sandbox lifecycle. | Apache-2.0 |
| **Object storage** | **MinIO** | S3-compatible store for logs/artifacts. | AGPL-3.0 (check) |

## Component-by-component

### 1. Web UI (chat + diff/PR review)
- Build: **Next.js / React**.
- Diff/review: **react-diff-view**, **diff2html**, **monaco-editor**.
- Chat UI kit (optional): **assistant-ui**, **shadcn/ui** primitives.

### 2. API Gateway / BFF
- **Envoy** or **Traefik** ingress; app-level BFF in the chosen backend framework.

### 3. Chat Service (channels, threads, DMs, mentions, realtime)
Two routes:
- **Fork an OSS chat backend** — **Zulip** (best threading model), **Mattermost** (Go+Postgres,
  channels/threads/mentions/realtime), or **Rocket.Chat**. Saves the chat plumbing but is
  **human-centric** — making *agents first-class participants* fights the grain.
- **Build light** on **NATS + Postgres** — full control, agents first-class by design, more work.
- _Recommendation TBD in Section 2; leaning build-light for agent-first semantics, borrowing
  data-model ideas from Zulip._

### 4. Task Service (Linear-style)
- **Plane** (open-source Linear alternative) or **Vikunja** — issues, states, assignment, handoff.
- Or build light (statuses are simple); embed Plane if we want a full board fast.

### 5. Orchestrator — the fusion brain
- **Temporal** workflows model: `mention → provision sandbox → run agent → push → open PR →
  stream checks → await review → merge`, with retries/timeouts/compensation for free.

### 6. Sandbox Controller (K8s operator)
- **OpenSandbox** as the runtime, or a custom **K8s operator** spawning **Kata/gVisor** pods or
  **Firecracker** microVMs as **Jobs**, with NetworkPolicy egress rules + ResourceQuota cost caps.
- Alternatives to evaluate: **E2B** (Firecracker, OSS), **Microsandbox** (libkrun microVMs).

### 7. Agent Adapter layer (pluggable)
- Agents are OSS/CLI: **Claude Code**, **OpenAI Codex CLI**, **Gemini CLI**, **Aider**,
  **OpenCode**, **Goose**.
- Protocols: **MCP** (tool calling), **A2A** (agent-to-agent), **ACP** (agent comms).
- Reference loops to learn/borrow from: **ComposioHQ/agent-orchestrator**, **BloopAI/vibe-kanban**,
  **stravu/crystal**, **Orca** — they already implement worktree-per-agent + PR.

### 8. GitHub Service
- **Octokit** (REST/GraphQL), **Probot** (GitHub App lifecycle), webhooks → threads.

### 9. Identity / Tenancy
- **Zitadel**/**Keycloak** (authn, orgs, SSO) + **OpenFGA**/**SpiceDB** (authz).

## Shared infra
Postgres · Redis · NATS · MinIO · OpenBao/Vault · OpenTelemetry stack · Temporal · Kubernetes
(+ gVisor/Kata/Firecracker).

## Reference codebases (don't reinvent the agent loop)
- **BloopAI/vibe-kanban** — board orchestrating many agents, branch/terminal/dev-server per agent.
- **ComposioHQ/agent-orchestrator** — fleet of agents, worktree+branch+PR, auto CI fixes.
- **stravu/crystal** (→ Nimbalyst) — multiple Claude Code/Codex sessions in worktrees (desktop).
- **Orca** — desktop IDE: parallel agents in worktrees, diff/PR/CI review.
- **andyrewlee/awesome-agent-orchestrators** — curated index.

## Sources
- Northflank — E2B / sandbox alternatives & self-hostable options (2026)
- Alibaba OpenSandbox (Apache-2.0, K8s + gVisor/Kata/Firecracker)
- Mattermost / Zulip / Rocket.Chat self-hosted chat backends
- Temporal, Zitadel, Keycloak, OpenFGA, SpiceDB, Octokit, Probot project docs
