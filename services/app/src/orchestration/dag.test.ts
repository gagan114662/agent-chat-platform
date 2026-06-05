import { describe, it, expect } from "vitest";
import { topoOrder, runGraph, type DagNode } from "./dag.js";

const NODES: DagNode[] = [
  { id: "plan", role: "planner", task: "decompose" },
  { id: "research", role: "researcher", task: "gather", deps: ["plan"] },
  { id: "code", role: "coder", task: "implement", deps: ["plan", "research"] },
  { id: "review", role: "reviewer", task: "review", deps: ["code"] },
];

describe("DAG execution graph (#150.2)", () => {
  it("orders nodes after their dependencies (deterministic)", () => {
    const order = topoOrder(NODES);
    expect(order.indexOf("plan")).toBeLessThan(order.indexOf("research"));
    expect(order.indexOf("code")).toBeLessThan(order.indexOf("review"));
    expect(order.indexOf("research")).toBeLessThan(order.indexOf("code"));
  });

  it("throws on a cycle (no chaos loops) and unknown deps", () => {
    expect(() => topoOrder([{ id: "a", role: "x", task: "", deps: ["b"] }, { id: "b", role: "x", task: "", deps: ["a"] }])).toThrow(/cycle/);
    expect(() => topoOrder([{ id: "a", role: "x", task: "", deps: ["ghost"] }])).toThrow(/unknown/);
  });

  it("runs in order, passing each node only its deps' results", async () => {
    const seen: Record<string, string[]> = {};
    const r = await runGraph(NODES, async (node, ctx) => {
      seen[node.id] = Object.keys(ctx);
      return `${node.id}-done`;
    });
    expect(r.order[0]).toBe("plan");
    expect(r.results.review).toBe("review-done");
    // code received exactly its deps' results (plan + research), nothing more
    expect(seen.code.sort()).toEqual(["plan", "research"]);
    expect(seen.plan).toEqual([]); // root sees no context
  });

  it("a human gate can skip a node (human-in-the-loop)", async () => {
    const r = await runGraph(NODES, async (n) => `${n.id}-done`, {
      gate: async (n) => n.id !== "code", // human rejects the coder step
    });
    expect(r.skipped).toContain("code");
    expect(r.results.code).toBeUndefined();
    expect(r.results.review).toBe("review-done"); // dependents still run
  });
});
