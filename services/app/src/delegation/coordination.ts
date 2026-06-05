import type { Match } from "./capability.js";

// #129 adaptive coordination: when a delegated run fails / times out / stalls, the
// coordinator must DO something — retry, re-delegate to the next-best actor, or
// escalate to a human — never stall silently. Pure decision over the outcome +
// attempt history + remaining alternatives (from capability matching #127).

export type RunOutcome = "merged" | "checks_failed" | "timeout" | "error" | "stalled" | "held_for_human";

export type CoordAction =
  | { kind: "done" }
  | { kind: "retry"; reason: string }
  | { kind: "redelegate"; to: string; reason: string }
  | { kind: "escalate"; reason: string };

export interface CoordCtx {
  outcome: RunOutcome;
  attempts: number;        // attempts so far (this delegation)
  maxAttempts: number;     // retry/redelegate budget before escalation
  triedIds: string[];      // actor ids already tried
  alternatives: Match[];   // ranked candidates (best first), from matchTask
}

export function reactToOutcome(c: CoordCtx): CoordAction {
  if (c.outcome === "merged") return { kind: "done" };
  if (c.outcome === "held_for_human") return { kind: "escalate", reason: "run is awaiting human approval" };
  // A failure/timeout/stall. Out of budget → escalate to a human (don't stall).
  if (c.attempts >= c.maxAttempts) {
    return { kind: "escalate", reason: `failed (${c.outcome}) after ${c.attempts} attempt(s); no budget left` };
  }
  // Prefer re-delegating to the best untried alternative over blindly retrying.
  const tried = new Set(c.triedIds);
  const next = c.alternatives.find((a) => !tried.has(a.id));
  if (next) return { kind: "redelegate", to: next.id, reason: `re-delegating after ${c.outcome} to next-best actor` };
  // No fresh actor — retry the same one (transient failures happen).
  return { kind: "retry", reason: `retrying after ${c.outcome} (no untried alternative)` };
}
