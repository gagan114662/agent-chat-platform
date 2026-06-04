import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryGraph, memoryStats } from "./api.js";

beforeEach(() => vi.restoreAllMocks());

describe("memory api", () => {
  it("memoryGraph hits /memory/graph with the scope query and parses { nodes, edges }", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ nodes: [{ id: "n1" }], edges: [{ id: "e1" }] }) })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", f);
    const g = await memoryGraph({ scope: "team" });
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/memory/graph?scope=team");
    expect(g.nodes.map((n) => n.id)).toEqual(["n1"]);
    expect(g.edges.map((e) => e.id)).toEqual(["e1"]);
  });
  it("memoryStats parses { nodes, edges }", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ nodes: 3, edges: 2 }) })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", f);
    const s = await memoryStats();
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/memory/stats");
    expect(s).toEqual({ nodes: 3, edges: 2 });
  });
});
