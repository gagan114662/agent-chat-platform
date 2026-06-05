// #130 auditable delegation chain: every hand-off (human→agent, agent→agent) is
// recorded as a link, so you can trace any action back to the accountable HUMAN and
// guarantee meaningful human control — a chain only runs if it's rooted in a human,
// and a human in the chain can always halt it. Pure data + queries.

export interface DelegationLink {
  byKind: "human" | "agent";
  byId: string;
  toKind: "human" | "agent";
  toId: string;
  taskId: string;
  at: string; // ISO timestamp (caller-supplied; no clock here so it's testable)
}

export type DelegationChain = DelegationLink[];

export function append(chain: DelegationChain, link: DelegationLink): DelegationChain {
  return [...chain, link];
}

// accountableHuman: the human at the root of the chain — accountability for the
// whole chain stays with the human who first delegated, no matter how many agent
// hand-offs followed. null if the chain isn't human-rooted (must not run, below).
export function accountableHuman(chain: DelegationChain): string | null {
  const first = chain[0];
  if (first && first.byKind === "human") return first.byId;
  // Otherwise find the earliest human actor anywhere in the chain.
  const h = chain.find((l) => l.byKind === "human");
  return h ? h.byId : null;
}

// isHumanRooted: meaningful human control — a delegation chain may only execute if
// it originates from a human (an agent can't bootstrap authority from nothing).
export function isHumanRooted(chain: DelegationChain): boolean {
  return chain.length > 0 && chain[0].byKind === "human";
}

// canHumanHalt: a human can always halt/override a chain they're accountable for.
export function canHumanHalt(chain: DelegationChain, humanId: string): boolean {
  return accountableHuman(chain) === humanId;
}

export function depth(chain: DelegationChain): number {
  return chain.length;
}
