import { describe, it, expect } from "vitest";
import { classifyDiff, type ChangedFile } from "./risk.js";

const f = (filename: string, additions = 5, deletions = 0, status = "modified"): ChangedFile => ({ filename, additions, deletions, status });

describe("classifyDiff", () => {
  it("auto-approves a small, safe diff", () => {
    const v = classifyDiff({ files: [f("src/util.ts"), f("README.md")] });
    expect(v.decision).toBe("auto");
    expect(v.reasons).toEqual([]);
  });
  it("flags protected paths (CI, secrets, migrations, deps)", () => {
    for (const name of [".github/workflows/ci.yml", "src/auth/secret.ts", "migrations/001.sql", "package.json"]) {
      expect(classifyDiff({ files: [f(name)] }).decision).toBe("human");
    }
  });

  it("forces a human gate on money / PII changes (#105)", () => {
    for (const name of ["src/payment/charge.ts", "lib/billing.ts", "src/user-pii.ts", "ssn_export.py"]) {
      const v = classifyDiff({ files: [f(name)] });
      expect(v.decision).toBe("human");
      expect(v.reasons.some((r) => /payments\/PII/.test(r))).toBe(true);
    }
    // A purely non-money safe diff still auto-approves (gate is money-specific, not blanket).
    expect(classifyDiff({ files: [f("src/util/format.ts")] }).decision).toBe("auto");
  });
  it("flags large diffs, too many files, deletions, big net-negative", () => {
    expect(classifyDiff({ files: [f("a.ts", 500, 0)] }).decision).toBe("human"); // > 400 lines
    expect(classifyDiff({ files: Array.from({ length: 16 }, (_, i) => f(`f${i}.ts`)) }).decision).toBe("human");
    expect(classifyDiff({ files: [f("gone.ts", 0, 0, "removed")] }).decision).toBe("human");
    expect(classifyDiff({ files: [f("big.ts", 0, 300)] }).decision).toBe("human"); // net -300
  });
});
