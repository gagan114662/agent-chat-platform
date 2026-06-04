import { describe, it, expect } from "vitest";
import { rankCulprits } from "./root-cause.js";
import type { ChangedFile } from "@acp/orchestrator/policy/risk.js";

const file = (filename: string, additions = 1, deletions = 0): ChangedFile => ({
  filename,
  additions,
  deletions,
  status: "modified",
});

describe("rankCulprits", () => {
  it("ranks the failure-mentioned file first even when another file has a huge diff", () => {
    const failure = "FAIL src/auth.ts:42 — TypeError: token undefined";
    const files = [
      file("src/auth.ts", 2, 1), // small, but named in the failure
      file("README.md", 500, 10), // huge diff, unrelated
    ];
    const ranked = rankCulprits(failure, files);
    expect(ranked[0].file).toBe("src/auth.ts");
    expect(ranked[0].reason).toContain("mentioned in CI failure");
    expect(ranked[1].file).toBe("README.md");
  });

  it("matches by basename when the failure names a path-less file", () => {
    const ranked = rankCulprits("Error in auth.ts", [file("src/lib/auth.ts"), file("src/util.ts")]);
    expect(ranked[0].file).toBe("src/lib/auth.ts");
  });

  it("matches by symbol stem (basename without extension)", () => {
    const ranked = rankCulprits("ReferenceError: parser is not defined", [
      file("src/parser.ts"),
      file("src/other.ts"),
    ]);
    expect(ranked[0].file).toBe("src/parser.ts");
    expect(ranked[0].reason).toContain("mentioned in CI failure");
  });

  it("flags protected paths (CI config) with a reason", () => {
    const ranked = rankCulprits("build broke", [
      file("src/x.ts", 1, 0),
      file(".github/workflows/ci.yml", 1, 0),
    ]);
    expect(ranked[0].file).toBe(".github/workflows/ci.yml");
    expect(ranked[0].reason).toContain("touches CI config");
  });

  it("falls back to largest-diff when nothing is mentioned", () => {
    const ranked = rankCulprits("opaque failure", [file("a.ts", 1, 1), file("b.ts", 50, 50)]);
    expect(ranked[0].file).toBe("b.ts");
    expect(ranked[0].reason).toContain("largest diff");
  });

  it("returns a default reason for ordinary changed files", () => {
    const ranked = rankCulprits("", [file("a.ts", 1, 0), file("b.ts", 1, 0)]);
    expect(ranked.every((s) => s.reason.length > 0)).toBe(true);
    expect(ranked.map((s) => s.file)).toEqual(["a.ts", "b.ts"]);
  });

  it("handles empty files list", () => {
    expect(rankCulprits("anything", [])).toEqual([]);
  });
});
