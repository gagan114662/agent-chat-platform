import type { Criticality } from "./risk.js";

// #124 contract-first task decomposition: every task ships with explicit acceptance
// criteria AND a verification method, so "done" is checkable (feeds #126 settlement)
// rather than vibes. Pure helpers; the planner/decompose attaches a contract.

export type VerificationMethod = "tests" | "checks" | "human_review" | "assertion";

export interface TaskContract {
  acceptanceCriteria: string[];
  verification: VerificationMethod;
  criticality: Criticality;
}

// contractFromCriteria turns a goal/task criteria blob into a contract: one
// acceptance line per non-empty criterion; verification defaults to "checks"
// (CI) which the fusion loop already produces. criticality defaults to medium.
export function contractFromCriteria(criteria: string, opts?: { verification?: VerificationMethod; criticality?: Criticality }): TaskContract {
  const acceptanceCriteria = criteria.split("\n").map((l) => l.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean);
  return {
    acceptanceCriteria,
    verification: opts?.verification ?? "checks",
    criticality: opts?.criticality ?? "medium",
  };
}

// A contract is valid (a task may be dispatched) only with at least one acceptance
// criterion and a verification method — no acceptance-free work.
export function isValidContract(c: TaskContract): boolean {
  return c.acceptanceCriteria.length > 0 && !!c.verification;
}
