export type RunState = "pending" | "running" | "merged" | "checks_failed" | "timeout" | "error";

const TRANSITIONS: Record<RunState, RunState[]> = {
  pending: ["running", "error"],
  running: ["merged", "checks_failed", "timeout", "error"],
  merged: [],
  checks_failed: [],
  timeout: [],
  error: [],
};

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export const TERMINAL_RUN_STATES: RunState[] = ["merged", "checks_failed", "timeout", "error"];
export function isTerminal(s: RunState): boolean { return TERMINAL_RUN_STATES.includes(s); }
