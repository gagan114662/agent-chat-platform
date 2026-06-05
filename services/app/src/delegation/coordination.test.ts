import { describe, it, expect } from "vitest";
import { reactToOutcome } from "./coordination.js";
import { append, accountableHuman, isHumanRooted, canHumanHalt, depth, type DelegationChain } from "./chain.js";

const alts = [{ id: "coder", kind: "agent" as const, score: 2 }, { id: "cursor", kind: "agent" as const, score: 1 }];

describe("#129 adaptive coordination", () => {
  it("done on merge", () => {
    expect(reactToOutcome({ outcome: "merged", attempts: 1, maxAttempts: 3, triedIds: ["coder"], alternatives: alts }).kind).toBe("done");
  });
  it("re-delegates to the next untried actor on failure", () => {
    const a = reactToOutcome({ outcome: "checks_failed", attempts: 1, maxAttempts: 3, triedIds: ["coder"], alternatives: alts });
    expect(a).toMatchObject({ kind: "redelegate", to: "cursor" });
  });
  it("retries when no untried alternative remains", () => {
    expect(reactToOutcome({ outcome: "timeout", attempts: 1, maxAttempts: 3, triedIds: ["coder", "cursor"], alternatives: alts }).kind).toBe("retry");
  });
  it("escalates to a human when out of budget (never stalls)", () => {
    expect(reactToOutcome({ outcome: "error", attempts: 3, maxAttempts: 3, triedIds: ["coder"], alternatives: alts }).kind).toBe("escalate");
  });
});

describe("#130 auditable delegation chain", () => {
  const base: DelegationChain = append([], { byKind: "human", byId: "alice", toKind: "agent", toId: "coder", taskId: "t1", at: "2026-01-01T00:00:00Z" });
  const handed = append(base, { byKind: "agent", byId: "coder", toKind: "agent", toId: "cursor", taskId: "t1", at: "2026-01-01T00:05:00Z" });

  it("traces accountability back to the root human through agent hand-offs", () => {
    expect(accountableHuman(handed)).toBe("alice");
    expect(depth(handed)).toBe(2);
  });
  it("a chain must be human-rooted to run (no agent bootstrapping authority)", () => {
    expect(isHumanRooted(handed)).toBe(true);
    const agentRooted: DelegationChain = [{ byKind: "agent", byId: "rogue", toKind: "agent", toId: "x", taskId: "t", at: "2026-01-01T00:00:00Z" }];
    expect(isHumanRooted(agentRooted)).toBe(false);
  });
  it("the accountable human can always halt; others cannot", () => {
    expect(canHumanHalt(handed, "alice")).toBe(true);
    expect(canHumanHalt(handed, "mallory")).toBe(false);
  });
});
