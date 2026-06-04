export type RunState = "pending" | "running" | "merged" | "checks_failed" | "timeout" | "error" | "held_for_human" | "awaiting_plan_approval";

const TRANSITIONS: Record<RunState, RunState[]> = {
  pending: ["running", "error", "awaiting_plan_approval"],
  running: ["merged", "checks_failed", "timeout", "error", "held_for_human"],
  merged: [],
  checks_failed: [],
  timeout: [],
  error: [],
  held_for_human: ["merged"], // human approval gate: a held run can be approved → merged
  awaiting_plan_approval: ["running", "error"], // plan gate (#20): approve → running; reject → error
};

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export const TERMINAL_RUN_STATES: RunState[] = ["merged", "checks_failed", "timeout", "error", "held_for_human"];
export function isTerminal(s: RunState): boolean { return TERMINAL_RUN_STATES.includes(s); }
