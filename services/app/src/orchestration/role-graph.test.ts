import { describe, it, expect } from "vitest";
import { defaultRoleGraph, runRoleGraph } from "./role-graph.js";
import type { NodeExec } from "./dag.js";

describe("role-graph (#150.2 runtime)", () => {
  it("builds Planner → Coder → Reviewer with the right dependencies + agents", () => {
    const g = defaultRoleGraph("ship dark mode");
    expect(g.map((n) => n.id)).toEqual(["plan", "code", "review"]);
    expect(g.find((n) => n.id === "code")?.deps).toEqual(["plan"]);
    expect(g.find((n) => n.id === "review")?.deps).toEqual(["code"]);
    expect(g.map((n) => n.agentHandle)).toEqual(["hermes", "coder", "cursor"]);
    expect(g[0].task).toContain("ship dark mode");
  });

  it("runs the team in order, threading each role's outcome to the next", async () => {
    const calls: { id: string; priorKeys: string[] }[] = [];
    const fakeExec: NodeExec = async (node, ctx) => {
      calls.push({ id: node.id, priorKeys: Object.keys(ctx) });
      return { runId: `run-${node.id}`, outcome: "merged" };
    };
    const out = await runRoleGraph(defaultRoleGraph("ship it"), fakeExec);
    expect(calls.map((c) => c.id)).toEqual(["plan", "code", "review"]); // strict order
    // the coder saw the planner's result; the reviewer saw the coder's.
    expect(calls.find((c) => c.id === "code")?.priorKeys).toEqual(["plan"]);
    expect(calls.find((c) => c.id === "review")?.priorKeys).toEqual(["code"]);
    expect((out.results.review as { outcome: string }).outcome).toBe("merged");
  });
});
