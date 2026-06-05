// #125 risk-adaptive permission gate. Generalizes the money-only human gate (#110)
// to ANY action: the decision is criticality × reversibility, so high-stakes or
// irreversible actions need a human (or are denied) while routine reversible ones
// run autonomously. Pure + deterministic — the proxy/orchestrator enforces it.

export type Criticality = "low" | "medium" | "high" | "critical";
export type Reversibility = "reversible" | "irreversible";
export type RiskDecision = "auto" | "human" | "deny";

const RANK: Record<Criticality, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export interface RiskPolicy {
  // Reversible actions at or below this criticality run autonomously. Default: medium.
  autoMaxReversible: Criticality;
  // Irreversible actions at or above this criticality are hard-denied. Default: critical.
  denyIrreversibleAt: Criticality;
}

export const DEFAULT_RISK_POLICY: RiskPolicy = { autoMaxReversible: "medium", denyIrreversibleAt: "critical" };

export function riskDecision(
  criticality: Criticality,
  reversibility: Reversibility,
  policy: RiskPolicy = DEFAULT_RISK_POLICY,
): { decision: RiskDecision; reason: string } {
  const c = RANK[criticality];
  if (reversibility === "irreversible") {
    if (c >= RANK[policy.denyIrreversibleAt]) {
      return { decision: "deny", reason: `irreversible + ${criticality}: hard-denied` };
    }
    return { decision: "human", reason: `irreversible (${criticality}): needs human approval` };
  }
  // reversible
  if (c <= RANK[policy.autoMaxReversible]) {
    return { decision: "auto", reason: `reversible + ${criticality}: within autonomous limit` };
  }
  return { decision: "human", reason: `reversible but ${criticality}: needs human approval` };
}
