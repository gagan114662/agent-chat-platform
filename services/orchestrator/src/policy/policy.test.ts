import { describe, it, expect } from "vitest";
import { decideMerge } from "./policy.js";

describe("decideMerge", () => {
  it("autopilot + low risk + green → merge", () => {
    expect(decideMerge({ autonomy: "autopilot-merge", risk: "auto", checks: "success", qaRequired: false, qaPassed: false }).action).toBe("merge");
  });
  it("holds when checks are not green", () => {
    expect(decideMerge({ autonomy: "autopilot-merge", risk: "auto", checks: "pending", qaRequired: false, qaPassed: false }).action).toBe("hold_for_human");
  });
  it("monitor-only never merges", () => {
    expect(decideMerge({ autonomy: "monitor-only", risk: "auto", checks: "success", qaRequired: false, qaPassed: false }).action).toBe("monitor");
  });
  it("risk tripwire holds even on autopilot", () => {
    expect(decideMerge({ autonomy: "autopilot-merge", risk: "human", checks: "success", qaRequired: false, qaPassed: false }).action).toBe("hold_for_human");
  });
  it("UI QA required but not passed holds", () => {
    expect(decideMerge({ autonomy: "autopilot-merge", risk: "auto", checks: "success", qaRequired: true, qaPassed: false }).action).toBe("hold_for_human");
  });
  it("resolve-ci dial holds for human merge even when green+safe", () => {
    expect(decideMerge({ autonomy: "resolve-ci", risk: "auto", checks: "success", qaRequired: false, qaPassed: false }).action).toBe("hold_for_human");
  });
});
