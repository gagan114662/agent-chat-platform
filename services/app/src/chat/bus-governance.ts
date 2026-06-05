// #111 agent-to-agent message-bus governance. A single deterministic decision for
// "may this @mention dispatch a run?" that bounds the agent↔agent bus against
// runaway loops: depth limit, no self-trigger, per-fan-out dedupe, and cycle
// detection (an agent already in the mention chain can't be re-triggered). Pure +
// testable; consolidates the inline guards in handle-mentions (#27).

export interface DispatchCtx {
  // The ordered agent ids whose @mentions led to the current message (the path).
  chain: string[];
  // The agent we're about to dispatch a run for.
  toAgentId: string;
  // Who authored the current message.
  fromAuthorKind: "human" | "agent";
  fromAuthorId: string;
  // Depth of the current message in the chain (human = 0).
  depth: number;
  // Agents already dispatched in THIS message's fan-out (e.g. via @team).
  alreadyDispatched: Set<string>;
  // Override the default depth cap (else ACP_MAX_MENTION_DEPTH, default 4).
  maxDepth?: number;
}

export interface DispatchVerdict { allow: boolean; reason?: string; }

export function maxMentionDepth(override?: number): number {
  if (typeof override === "number") return override;
  const n = Number(process.env.ACP_MAX_MENTION_DEPTH);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

// governDispatch returns whether a run may be started for `toAgentId`, and why not.
export function governDispatch(c: DispatchCtx): DispatchVerdict {
  const cap = maxMentionDepth(c.maxDepth);
  if (c.depth >= cap) return { allow: false, reason: `max mention depth ${cap} reached` };
  if (c.fromAuthorKind === "agent" && c.toAgentId === c.fromAuthorId) {
    return { allow: false, reason: "self-trigger blocked" };
  }
  if (c.alreadyDispatched.has(c.toAgentId)) {
    return { allow: false, reason: "already dispatched in this fan-out (dedupe)" };
  }
  if (c.chain.includes(c.toAgentId)) {
    return { allow: false, reason: "cycle: agent already in the mention chain" };
  }
  return { allow: true };
}
