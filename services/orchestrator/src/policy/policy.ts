export type Autonomy = "monitor-only" | "resolve-ci" | "autopilot-merge";
export type MergeAction = "merge" | "hold_for_human" | "monitor";

export interface PolicyInput {
  autonomy: Autonomy;
  risk: "auto" | "human";
  checks: "success" | "failure" | "pending";
  qaRequired: boolean;
  qaPassed: boolean;
}

// Resolves the merge decision from the repo's autonomy dial, the risk verdict,
// CI status, and the QA-for-UI gate (spec §5 merge policy).
export function decideMerge(i: PolicyInput): { action: MergeAction; reason: string } {
  if (i.checks !== "success") return { action: "hold_for_human", reason: `checks ${i.checks}` };
  if (i.autonomy === "monitor-only") return { action: "monitor", reason: "monitor-only dial" };
  if (i.qaRequired && !i.qaPassed) return { action: "hold_for_human", reason: "UI QA required but not passed" };
  if (i.risk === "human") return { action: "hold_for_human", reason: "risk tripwire" };
  if (i.autonomy === "autopilot-merge") return { action: "merge", reason: "autopilot: green, low-risk, QA ok" };
  return { action: "hold_for_human", reason: "resolve-ci dial: human merges" };
}
