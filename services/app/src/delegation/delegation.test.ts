import { describe, it, expect } from "vitest";
import { riskDecision } from "./risk.js";
import { contractFromCriteria, isValidContract } from "./contract.js";
import { matchTask, type CapabilityProfile } from "./capability.js";
import { score, update, meetsStanding } from "./reputation.js";
import { gateSettlement } from "./settlement.js";

describe("#125 risk-adaptive gate", () => {
  it("reversible low/medium → auto; high → human", () => {
    expect(riskDecision("low", "reversible").decision).toBe("auto");
    expect(riskDecision("medium", "reversible").decision).toBe("auto");
    expect(riskDecision("high", "reversible").decision).toBe("human");
  });
  it("irreversible → human, critical irreversible → deny (generalizes the money gate)", () => {
    expect(riskDecision("low", "irreversible").decision).toBe("human");
    expect(riskDecision("high", "irreversible").decision).toBe("human");
    expect(riskDecision("critical", "irreversible").decision).toBe("deny");
  });
});

describe("#124 contract-first decomposition", () => {
  it("builds acceptance criteria + a verification method from criteria lines", () => {
    const c = contractFromCriteria("- build the page\n- take a payment");
    expect(c.acceptanceCriteria).toEqual(["build the page", "take a payment"]);
    expect(c.verification).toBe("checks");
    expect(isValidContract(c)).toBe(true);
  });
  it("an acceptance-free contract is invalid (no work without criteria)", () => {
    expect(isValidContract(contractFromCriteria(""))).toBe(false);
  });
});

describe("#127 capability matching", () => {
  const profiles: CapabilityProfile[] = [
    { id: "coder", kind: "agent", skills: ["frontend", "stripe"], maxCriticality: "high" },
    { id: "intern", kind: "agent", skills: ["frontend"], maxCriticality: "low" },
    { id: "alice", kind: "human", skills: ["frontend", "stripe", "legal"], maxCriticality: "critical" },
  ];
  it("routes to the best skill overlap within the criticality the actor is trusted with", () => {
    const m = matchTask({ skills: ["frontend", "stripe"], criticality: "high" }, profiles);
    expect(m?.id).toBe("coder"); // intern excluded (low<high); coder beats none; agent preferred
  });
  it("excludes actors not trusted with the task's criticality", () => {
    const m = matchTask({ skills: ["frontend"], criticality: "critical" }, profiles);
    expect(m?.id).toBe("alice"); // only alice covers critical
  });
  it("returns null when nobody is eligible", () => {
    expect(matchTask({ skills: ["welding"], criticality: "critical" }, [profiles[1]])).toBeNull();
  });
});

describe("#128 reputation", () => {
  it("starts neutral (0.5), moves with outcomes", () => {
    const r0 = { id: "a", success: 0, fail: 0 };
    expect(score(r0)).toBeCloseTo(0.5);
    const r1 = update(update(update(r0, "success"), "success"), "success");
    expect(score(r1)).toBeGreaterThan(0.7);
  });
  it("standing permission is earned (min runs + score)", () => {
    const proven = { id: "a", success: 9, fail: 1 };
    expect(meetsStanding(proven, { minRuns: 5, minScore: 0.8 })).toBe(true);
    expect(meetsStanding({ id: "b", success: 1, fail: 0 }, { minRuns: 5, minScore: 0.8 })).toBe(false); // too few runs
  });
});

describe("#126 verified settlement", () => {
  const contract = contractFromCriteria("- ship it"); // verification: checks
  it("settles (merge+pay+rep) only when verification passes", () => {
    const s = gateSettlement(contract, { method: "checks", passed: true });
    expect(s).toMatchObject({ merge: true, pay: true, updateReputation: true, reputationOutcome: "success" });
  });
  it("a failed verification settles nothing and dings reputation", () => {
    const s = gateSettlement(contract, { method: "checks", passed: false, detail: "tests red" });
    expect(s.merge).toBe(false); expect(s.pay).toBe(false);
    expect(s.reputationOutcome).toBe("fail");
  });
  it("fails closed when the verification method doesn't match the contract", () => {
    const s = gateSettlement(contract, { method: "human_review", passed: true });
    expect(s.merge).toBe(false);
  });
});
