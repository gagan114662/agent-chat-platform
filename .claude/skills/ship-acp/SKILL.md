---
name: ship-acp
description: The end-to-end ship workflow for agent-chat-platform — bundles verify, a second-agent review, PR, and CI watch. Run when a change (or a plan slice) is complete and ready to land.
---

# ship-acp

Bundles the feedback loops this repo uses so a change goes from "done" to "merged" with verification at
both layers: in-loop self-verification, and a **second agent that didn't write the code** reviewing before merge.

## Step 1 — Self-verify (in-loop)
Run the **verify-acp** skill (deterministic suites + tsc/build; live e2e if the fusion loop changed).
If the diff touches `services/web`, also run **frontend-verify**. Fix and re-run until green.

## Step 2 — Clean up the diff
Run `/simplify` (or `/code-review --fix` at low effort) on the working tree to remove dead code,
duplication, and obvious cleanups. Re-run verify-acp if it changed anything.

## Step 3 — Second-agent review (before merge — the honest pass)
A fresh agent with no context catches what the author missed. For a substantive change use the
**two-stage review this project standardized on** (see `docs/plans/*` + superpowers:subagent-driven-development):
1. **Spec-compliance reviewer** — built exactly what was asked, nothing more/less; verify by reading code, not the report.
2. **Code-quality reviewer** — clean, tested, no security/correctness gaps; for auth/secrets/risky diffs use adversarial/perspective-diverse reviewers.
Fix findings, re-review until approved. (`/code-review` posts parallel-subagent findings on the PR; `/review` is a quick single pass.)

## Step 4 — PR
Branch off `main`, push, open a PR with a Summary + Test plan (paste the verify evidence). Commit with the
repo identity: `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

## Step 5 — Merge + watch
After review approves and CI is green: `gh pr merge <n> --merge --delete-branch`, sync `main`, and confirm
suites are still green on `main`. If CI fails, fix-on-red and re-push (don't leave a red `main`).

## Notes
- One PR per slice; keep `main` always-green. Update `HANDOVER.md` / `docs/BACKLOG.md` when status changes.
- Secrets never get committed; redact tokens in any pasted output.
