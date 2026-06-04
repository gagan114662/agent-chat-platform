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
