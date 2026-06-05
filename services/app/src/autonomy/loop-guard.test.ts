import { describe, it, expect } from "vitest";
import { LoopGuard, fingerprint } from "./loop-guard.js";

describe("LoopGuard (#149.1)", () => {
  it("trips on the iteration cap", () => {
    const g = new LoopGuard(5, 99); // cap 5, effectively no repeat-window trip
    let v = { trip: false } as ReturnType<LoopGuard["step"]>;
    for (let i = 0; i < 6; i++) v = g.step("k", "act", { i }); // 6 distinct steps > cap 5
    expect(v.trip).toBe(true);
    expect(v.reason).toMatch(/iteration cap/);
  });

  it("trips immediately on semantic repetition (same action+params 3×)", () => {
    const g = new LoopGuard(99, 3);
    g.step("k", "callTool", { name: "search", q: "x" });
    g.step("k", "callTool", { name: "search", q: "x" });
    const v = g.step("k", "callTool", { name: "search", q: "x" }); // 3rd identical → trip
    expect(v.trip).toBe(true);
    expect(v.reason).toMatch(/repeated the same action/);
  });

  it("does NOT trip when actions vary (real progress)", () => {
    const g = new LoopGuard(99, 3);
    expect(g.step("k", "callTool", { name: "search", q: "a" }).trip).toBe(false);
    expect(g.step("k", "callTool", { name: "search", q: "b" }).trip).toBe(false);
    expect(g.step("k", "callTool", { name: "edit", path: "x" }).trip).toBe(false);
  });

  it("fingerprint is stable + params-sensitive; keys are independent", () => {
    expect(fingerprint("a", { x: 1 })).toBe(fingerprint("a", { x: 1 }));
    expect(fingerprint("a", { x: 1 })).not.toBe(fingerprint("a", { x: 2 }));
    const g = new LoopGuard(99, 2);
    g.step("k1", "same"); g.step("k1", "same");
    expect(g.step("k2", "same").trip).toBe(false); // k2's trail is independent of k1
  });
});
