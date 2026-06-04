import { describe, it, expect } from "vitest";
import { canTransition, type RunState } from "./runs.js";

describe("run state machine", () => {
  it("allows pending→running→merged", () => {
    expect(canTransition("pending", "running")).toBe(true);
    expect(canTransition("running", "merged")).toBe(true);
  });
  it("allows running→checks_failed / timeout / error", () => {
    for (const s of ["checks_failed", "timeout", "error"] as RunState[]) {
      expect(canTransition("running", s)).toBe(true);
    }
  });
  it("rejects transitions out of terminal states", () => {
    for (const t of ["merged", "checks_failed", "timeout", "error"] as RunState[]) {
      expect(canTransition(t, "running")).toBe(false);
    }
  });
  it("rejects skipping pending→merged", () => {
    expect(canTransition("pending", "merged")).toBe(false);
  });
  it("allows running→held_for_human and treats it terminal", () => {
    expect(canTransition("running", "held_for_human")).toBe(true);
    expect(canTransition("held_for_human", "running")).toBe(false);
  });
  it("allows held_for_human→merged (human approval) but not other transitions out", () => {
    expect(canTransition("held_for_human", "merged")).toBe(true);
    expect(canTransition("held_for_human", "running")).toBe(false);
    expect(canTransition("merged", "running")).toBe(false); // merged stays terminal
  });
});
