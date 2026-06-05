import type { TaskContract } from "./contract.js";

// #126 verifiable completion gates settlement: merge, payment, and reputation
// updates fire ONLY after the task's contract verification passes. No green check
// → nothing settles (no merge, no pay, no rep bump). Pure decision; callers perform
// the actions guarded by it.

export interface VerificationResult {
  method: TaskContract["verification"];
  passed: boolean;
  detail?: string;
}

export interface Settlement {
  merge: boolean;
  pay: boolean;
  updateReputation: boolean;
  reputationOutcome: "success" | "fail";
  reason: string;
}

// gateSettlement: if verification passed → allow merge + pay + a success rep bump.
// If it failed → nothing settles, and reputation takes a fail (the actor is
// accountable for a non-passing result). Verification of the WRONG method for the
// contract is treated as not-verified (fail-closed).
export function gateSettlement(contract: TaskContract, v: VerificationResult): Settlement {
  if (v.method !== contract.verification) {
    return { merge: false, pay: false, updateReputation: false, reputationOutcome: "fail", reason: `verification method ${v.method} != contract ${contract.verification}` };
  }
  if (!v.passed) {
    return { merge: false, pay: false, updateReputation: true, reputationOutcome: "fail", reason: `verification failed: ${v.detail ?? contract.verification}` };
  }
  return { merge: true, pay: true, updateReputation: true, reputationOutcome: "success", reason: "verification passed" };
}
