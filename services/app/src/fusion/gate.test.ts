import { describe, it, expect, vi } from "vitest";
import { buildMergeGate } from "./gate.js";
import type { ChangedFile } from "@acp/orchestrator/policy/risk.js";

function github(files: ChangedFile[]) {
  return { getChangedFiles: vi.fn().mockResolvedValue(files) } as any;
}
const info = { prNumber: 7, prUrl: "u", commitSha: "s", branch: "b" };

describe("buildMergeGate", () => {
  it("autopilot + safe diff → merge", async () => {
    const gate = buildMergeGate(github([{ filename: "src/util.ts", additions: 3, deletions: 0, status: "modified" }]), { owner: "o", repo: "r", autonomy: "autopilot-merge" });
    expect((await gate(info)).merge).toBe(true);
  });
  it("risky diff (deps) → hold", async () => {
    const gate = buildMergeGate(github([{ filename: "package.json", additions: 1, deletions: 0, status: "modified" }]), { owner: "o", repo: "r", autonomy: "autopilot-merge" });
    expect((await gate(info)).merge).toBe(false);
  });
  it("monitor-only → never merge", async () => {
    const gate = buildMergeGate(github([{ filename: "src/util.ts", additions: 1, deletions: 0, status: "modified" }]), { owner: "o", repo: "r", autonomy: "monitor-only" });
    expect((await gate(info)).merge).toBe(false);
  });
});
