# Backlog — parity gaps from conductor.build

**Source:** https://www.conductor.build/changelog (reviewed 2026-06-04)
**Why:** conductor.build is one of the two products our platform fuses (execution side). Its shipped
features are a strong signal for what our chat-driven agent platform still lacks. Below: the relevant
gaps, mapped to our architecture, prioritized. Top items are filed as GitHub issues (see links once created).

Legend: ✅ already have · 🔜 partial/foundation exists · ❌ not started.

## P0 — core review/merge loop (our wedge)
1. **In-thread diff viewer + line-level code review** (conductor 0.9/0.16/0.22/0.29). We post a `pr_card`
   only; no diff UI, no commenting. ❌ — biggest UX gap. Backend has `getChangedFiles`; need a diff
   fetch + a React diff view + comment→`apply_feedback` wiring.
2. **CI-resolution loop (fix-on-red)** (conductor 0.12 "failed CI check forwarding"). Our spec's
   Agent-Merge loop; `runFusion` currently gates on red, doesn't fix. 🔜 — `held_for_human` exists;
   add: on `checks_failed`, fetch failure logs → `Adapter.apply_feedback` in the SAME sandbox → push →
   re-poll, bounded by N attempts (spec §5).
3. **PR comment sync (GitHub → thread → agent)** (conductor 0.25.4/0.25.11). Request-changes loop:
   GitHub PR review comments arrive in the thread and feed `apply_feedback`. ❌ — needs a GitHub
   webhook/poller + `apply_feedback` wiring.
4. **Plan mode / approve-before-execute + steering** (conductor 0.21/0.28/0.41/0.50). Agent proposes a
   plan in-thread, human approves/steers before it runs. 🔜 — ties into the risk router + tool-approval.

## P1 — agent control & integrations
5. **Tool-approval workflow** (conductor 0.41). Human approves risky tool calls mid-run; pairs with our
   Layer-B tripwires / `held_for_human`. ❌
6. **Multiple concurrent agent sessions per task / parallel runs** (conductor 0.17). One Task → many
   Runs is in the data model; need concurrent execution + UI. 🔜
7. **GitHub Issues + Linear integration** (conductor 0.15/0.32) — create Tasks from issues, sync status. ❌
8. **Multi-provider models for adapters** (conductor 0.13.6 Bedrock/Vertex/custom). Our adapter SDK
   abstracts agents; add provider config per agent. 🔜 (SDK exists; Claude Code adapter shipped.)
9. **MCP integration + message queue** (conductor 0.1.0). Protocol-agent bridge (spec §7 "protocol
   agents"). ❌

## P2 — UX & workflow polish
10. **Slash commands + command palette + chat search** (conductor 0.1.1/0.14/0.31). ❌
11. **File previews / explorer / HTML previews in thread** (conductor 0.16/0.20/0.45/0.55). ❌
12. **Notifications + unread markers + run/workspace status indicators** (conductor 0.25.11/0.35). ❌
13. **Checkpoints — run state save/restore** (conductor 0.19). 🔜 (Temporal gives durability; expose it.)
14. **Editable PR title/description + target-branch switching** (conductor 0.34.1/0.28.7). ❌
15. **Todos / notes per thread** (conductor 0.27/0.28.4). ❌
16. **Workspace forking + multiple git repos per workspace** (conductor 0.25.6). 🔜 (multi-repo data
    model partly there.)
17. **Sound/color/typography customization, scroll polish** (conductor 0.52/0.56). ❌ low priority.

## Infra parity (already on our roadmap / HANDOVER)
- **GitHub App + webhooks** (conductor 0.0.17 foundation, fine-grained perms 0.0.21) — we use a PAT;
  a GitHub App + webhooks unblocks PR-comment sync (#3) and check events. ❌
- **conductor.json-style per-repo config** (conductor 0.11) — our `repos` row carries autonomy; extend
  to a checked-in config. 🔜
- Real browser QA execution, RLS enforcement, NATS, OTLP export, billing — tracked in `HANDOVER.md`.

---
*Maintained alongside `HANDOVER.md`. New conductor.build releases → re-review and append here.*

---

# Gap analysis vs reload.chat (comms side we fuse)

**Source:** https://reload.chat/ (reviewed 2026-06-04). reload.chat is the chat/coordination/**memory** side
of the wedge. ✅ have · 🔜 partial · ❌ missing.

## Have / partial
- Channels, Threads ✅ (2.1a) · DMs ✅ (2.1c) · message search ✅ (2.1b)
- `@mention` an agent → it executes ✅ (the fusion seam) · Tasks: create/assign/status ✅ (open/in_progress/done/blocked)
- Agents as first-class principals ✅ · basic RBAC (admin/member) 🔜 · session auth ✅ (2.2a–c)
- Adapter SDK (vendor-neutral contract) ✅ + real Claude Code (CLI) adapter ✅
- 24/7 autonomous between decision points 🔜 (Temporal durability + `held_for_human`)

## Missing — the real reload.chat differentiators we have NOT built
- **Memory / typed context graph** ❌ — automatic capture of decisions/facts/preferences/identities/artifacts,
  shared across humans+agents, persistent. We persist messages only. This is the biggest gap. (issue filed)
- **Multi-agent coordination + agent↔agent mentions + task hand-off** ❌ — agents reassigning work to each
  other in a channel. We run one agent per mention; no inter-agent coordination. (issue filed)
- **Protocol agents (MCP / ACP / A2A / REST bridges)** ❌ — SDK contract exists; only the CLI adapter is real.
  (overlaps BACKLOG P1 #9 MCP) (issue filed)
- **Human-in-the-loop approvals (`@human` for sensitive actions)** ❌ — overlaps tool-approval / plan-mode
  (issues #20/#21). Wire `needs_input`/`confidence` from the adapter contract into a thread approval.
- **Agent pools / cross-team agent sharing** ❌ — pull agents from multiple teams into a channel. (issue filed)
- **Richer RBAC** ❌ — read/write/**propagate** scoped to personal/project/team/org (we have admin/member). (issue filed)
- **Task niceties** 🔜/❌ — "In Review" state; link tasks to memory/files for context hand-off.
- **Command palette (⌘K), notifications/unread, retention tiers** ❌ (overlaps conductor backlog #10/#12).
