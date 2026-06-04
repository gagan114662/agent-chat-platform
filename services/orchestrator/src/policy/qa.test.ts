import { describe, it, expect } from "vitest";
import { needsUiQa, passThroughQa } from "./qa.js";
import type { ChangedFile } from "./risk.js";

const f = (filename: string): ChangedFile => ({ filename, additions: 1, deletions: 0, status: "modified" });

describe("qa gate", () => {
  it("needsUiQa true when UI files change", () => {
    expect(needsUiQa([f("src/App.tsx")])).toBe(true);
    expect(needsUiQa([f("src/styles.css")])).toBe(true);
    expect(needsUiQa([f("src/server.ts")])).toBe(false);
  });
  it("passThroughQa returns passed", async () => {
    const r = await passThroughQa.run({ prNumber: 1, branch: "b" });
    expect(r.passed).toBe(true);
  });
});
