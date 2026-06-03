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

## 5. The fusion flow (Section 2 — APPROVED)

Modeled as a **Temporal workflow** so every step survives crashes and can retry/resume.

```
[1] @agent mentioned in thread (intent, e.g. "fix the login bug")
[2] Orchestrator validates: agent exists? permitted on repo? tenant within quota?
[3] Create Task (IN_PROGRESS) linked to the thread
[4] Sandbox Controller provisions isolated pod:
      clone repo @ base branch · inject scoped GitHub token + agent key (Vault)
      · egress allowlist · CPU/mem/time/cost caps
[5] Agent Adapter runs the agent; stream stdout/progress into the thread live
[6] Agent finishes → commit on new branch → push
[7] GitHub Service opens PR; CI checks start (incl. QA-for-UI check)
[7.5] QA GATE (conditional): if diff touches UI →
      ephemeral preview deploy → browser QA (Playwright + agent-driven):
      smoke flows, console errors, visual diff, responsive, a11y basics.
      Treated as a required check in the loop below.
[CI RESOLUTION LOOP] (Agent-Merge-style — actively drive CI green):
      monitor checks → on RED: fetch failure logs → agent fixes in SAME
      sandbox → push → re-run. Repeat up to N=3 attempts / time cap.
      Still red → escalate to human with "tried X,Y,Z; blocker is …".
[8] RISK ROUTER (only when all green):
      eligible for autopilot → AUTO-MERGE ✅
      forced-human          → post review card, @mention human, wait
[9] merged → Task DONE → sandbox destroyed → logs/artifacts archived
```

### Merge policy (decided)
- **Auto-merge is the default** ("autopilot"), from day one.
- **Autonomy dial** per-repo & per-agent: `monitor-only → resolve-CI → autopilot-merge`
  (ships at autopilot). "You decide what ships."
- **CI is actively resolved, not just gated** (the Agent-Merge behavior): agent reads
  failing checks and fixes them, bounded by attempt/time caps.
- **QA-for-UI is mandatory**: any diff touching UI must pass automated browser QA before
  merge (auto or human path). QA failures feed back into the CI resolution loop.

### "Genuinely needs a human" = two layers (decided)
- **Layer A — honor the repo's own rules.** Never bypass GitHub branch protection /
  CODEOWNERS required reviewers. Augment GitHub's permission model, don't replace it.
- **Layer B — safety tripwires** on top, per-repo configurable: auth/secrets/crypto, DB
  migrations, infra/CI/deploy config, deletes / large net-negative diffs, public-API
  contract changes, diff size over threshold (default >400 lines or >15 files), dependency
  add/bump, payments/PII globs, any red check/QA, agent self-flagged low confidence.
- **Shadow mode**: a tenant can run auto-merge observe-only first (logs what it *would*
  have merged) to build trust before enabling for real.

## 6. Data model & multi-tenancy (Section 3 — APPROVED)

Postgres; every row scoped by `org_id`.

```
Org ──< Workspace ──< Channel ──< Thread ──< Message (author = Human | Agent)
 │           ├──< Repo (GitHub install + merge policy)
 │           ├──< Member (Human)
 │           └──< Agent (identity + adapter cfg)
 └──< Task ──┬─ linked Thread
             ├─ assignee (Human | Agent)
             └──< Run (one execution attempt)
                    ├─ Sandbox (pod id, lifecycle, cost)
                    ├─ PR (github #, branch, checks, QA result)
                    └─ Event log (streamed steps)
```

### Decisions
- **Agents are first-class principals** (own identity/permissions/per-repo config; author
  messages, own tasks, open PRs natively) — not second-class bot-users. This is why we lean
  toward **building the chat service** rather than forking Zulip/Mattermost.
- **`Run` is the unit of execution & audit**: one Task → many Runs (retries / request-changes
  loops); each Run owns exactly one Sandbox and at most one PR. Cost/logs/outcome always
  trace to a Run.
- **`Repo` carries the merge policy** (autonomy dial + Layer-B tripwires + protected globs).

### Tenant isolation = defense in depth (decided)
- **Postgres Row-Level Security** keyed on `org_id` on every table.
- **One Kubernetes namespace per org** for sandboxes: NetworkPolicy, ResourceQuota, secrets
  scoped per namespace. A tenant's agent code cannot reach another tenant's data or pods.
- **Cluster-per-org** offered later as a premium/compliance tier.

## 7. Agent adapter interface (Section 4 — APPROVED)

One contract every agent implements; adding an agent is config, not a fork.

```
AgentAdapter
├─ identify()        → name, version, capabilities (can_edit_code, can_run_tests, …)
├─ prepare(ctx)      → install/auth CLI; ctx = {repo path, intent, secrets, env}
├─ run(intent)       → emits a STREAM of typed events:
│     log(line) · progress(step,pct) · file_changed(path) ·
│     needs_input(prompt) · confidence(score) · done(summary)
├─ apply_feedback(notes) → request-changes / CI-fix loop
└─ teardown()
```

### Two styles behind one interface
- **CLI agents** (Claude Code, Codex CLI, Aider…): adapter wraps the binary, parses
  output → typed events.
- **Protocol agents** (MCP / A2A / ACP / REST): adapter bridges protocol → same events.
  Also how non-coding agents (designer, QA) join chat without a sandbox.

### Decisions
- **One event stream, many agents** — orchestrator/UI never special-case an agent.
- **`confidence()` and `needs_input()` are contract-level** — feed the risk router and let
  an agent pull a human mid-run.
- **Adapters run inside the per-org sandbox** — a bad adapter can't escape tenant isolation.

### Extensibility model (decided): Open adapter SDK + registry from day one
- Publish the **adapter SDK** and a **registry** immediately; third parties/customers can
  publish agents at launch. Ship first-party adapters (Claude Code, Codex, Gemini, Aider) as
  reference implementations on the same SDK.
- **⚠️ Risk:** committing to a public contract early while the platform is still moving.
  **Mitigation:** strict **semantic versioning of the adapter SDK**, a capability-negotiation
  field in `identify()`, and a compatibility window so old adapters keep working across
  platform changes.

## 8. Sandbox isolation, security & cost controls (Section 5 — APPROVED)

Highest-risk subsystem: untrusted agent code, real repos, real tokens. Opinionated defaults.

### Isolation (defense in depth)
- Fresh pod per Task-work-session in the **org's namespace**, on **gVisor or Kata** runtime
  (kernel/microVM boundary, not just a container).
- **NetworkPolicy egress allowlist**: only git remote + agent LLM API + package registries;
  everything else blocked (anti-exfiltration).
- **No standing secrets**: short-lived, scoped GitHub installation token (one repo) + agent
  key injected at start, revoked at teardown (Vault/OpenBao).
- Read-only base image; only the worktree volume writable; all Linux capabilities dropped.

### Cost & runaway controls
- Per-session caps: CPU/mem, wall-clock timeout, max LLM spend → graceful stop + thread note.
- Per-org **ResourceQuota** (max concurrent sandboxes) — no noisy-neighbor starvation.
- **Metered per Run** (compute + LLM tokens) → billing + dashboard.
- Aggressive teardown at terminal state; reaper kills orphans.

### Supply-chain / prompt-injection hardening
- Repo content is treated as **untrusted input**; minimal token scope + locked egress make
  injection low-impact.
- Adapters pinned by digest; registry scans them.

### Lifecycle (decided): sandbox alive across the Task's loops
- One sandbox **persists through the active Task work** — initial run, CI-resolution loop, and
  request-changes iterations — then destroyed at terminal state. Faster iteration, retained
  context.
- **Complementary (later):** a small **warm pool + scale-to-zero** for instant first pickup,
  and optional **snapshot/restore** for near-instant cold starts.

## 9. Error handling, observability & testing strategy (Section 6 — APPROVED)

### Error handling (fail loudly in the thread, never silently)
- Every failure maps to a **thread message + Task state**: provision fail → retry×N →
  `BLOCKED`; agent crash → capture logs → retry/`BLOCKED`; CI unresolved after N → escalate to
  human; budget hit → graceful stop + "hit budget" card.
- **Temporal durability**: service restart mid-Run resumes from the last completed step — no
  orphaned sandboxes or lost PRs.
- **Idempotency**: external actions (open PR, merge, create branch) keyed by Run id so retries
  never double-act.

### Observability
- **OpenTelemetry** trace per Run spanning mention → sandbox → agent → PR → merge
  (org/run/agent attributes).
- Metrics: time-to-first-output, CI-resolution success rate, auto-merge rate, human-gate rate,
  cost per Run, sandbox utilization.
- **Per-org dashboard** incl. a "what auto-merged" **audit log** (trust-critical).

### Testing strategy
- **Unit**: adapter contract conformance (golden event-stream spec), risk classifier, policy
  engine.
- **Integration**: a **fake agent adapter** + **throwaway test GitHub repo** exercising the
  full mention→merge loop deterministically in CI.
- **Isolation/security tests**: assert egress blocked, secrets revoked at teardown, cross-tenant
  access fails (tests, not hopes).
- **Dogfooding**: QA-for-UI uses the same browser-QA harness shipped to users.

---

## 10. Build sequencing (thin vertical slice first)

Per the Approach-C risk mitigation, build a **walking skeleton** before horizontal scale:
**one tenant · one repo · one agent · mention → sandbox → PR → auto-merge**. Harden isolation,
add the SDK/registry, multi-agent, dashboards, and scale-out afterward. Detailed phasing lives
in the implementation plan (see `docs/plans/`).

**Spec status:** ✅ Complete — all 6 sections approved. Ready for implementation planning.
