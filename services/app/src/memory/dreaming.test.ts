import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { clusterNodes, consolidate, defaultSynthesize, type Synthesizer } from "./dreaming.js";
import { createNode } from "./memory.js";
import { memoryNodes, memoryEdges, orgs } from "../db/schema.js";
import { and, eq } from "drizzle-orm";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); await h.db.insert(orgs).values({ id: "o1", name: "O" }); });

describe("clusterNodes", () => {
  it("groups nodes sharing >= 2 significant terms; excludes loners and size-1 clusters", () => {
    const clusters = clusterNodes([
      { id: "a", kind: "decision", label: "postgres listen notify realtime", body: "" },
      { id: "b", kind: "decision", label: "realtime notify via postgres", body: "" },
      { id: "c", kind: "fact", label: "scrypt password hashing", body: "" },
    ]);
    expect(clusters.length).toBe(1);
    expect(clusters[0].ids).toEqual(["a", "b"]);
    // loner "c" not present in any cluster
    expect(clusters.flatMap((cl) => cl.ids)).not.toContain("c");
  });

  it("transitively unions A-B and B-C into one cluster of three", () => {
    const clusters = clusterNodes([
      { id: "a", kind: "fact", label: "postgres realtime notify", body: "" },
      { id: "b", kind: "fact", label: "realtime notify channels", body: "" },
      { id: "c", kind: "fact", label: "notify channels listener", body: "" },
    ]);
    expect(clusters.length).toBe(1);
    expect(clusters[0].ids).toEqual(["a", "b", "c"]);
  });
});

describe("consolidate", () => {
  it("clusters 2 related raw nodes (1 unrelated excluded), writes one idempotent dream node + consolidates edges, org-scoped", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    const a = await createNode(h.db, { orgId: "o1", kind: "decision", label: "Use Postgres LISTEN NOTIFY realtime" });
    const b = await createNode(h.db, { orgId: "o1", kind: "decision", label: "realtime notify via postgres listen" });
    await createNode(h.db, { orgId: "o1", kind: "fact", label: "scrypt password hashing" });
    // org-B node sharing the same terms must never be pulled into org-A consolidation
    await createNode(h.db, { orgId: "o2", kind: "decision", label: "Use Postgres LISTEN NOTIFY realtime notify" });

    const received: { kind: string; label: string; body: string }[][] = [];
    const fake: Synthesizer = (members) => { received.push(members); return { label: "FAKE LABEL", body: "FAKE BODY" }; };

    const r1 = await consolidate(h.db, "o1", { synthesize: fake });
    expect(r1).toEqual({ created: 1, clusters: 1 });

    // the fake synthesizer received exactly the 2 cluster members
    expect(received.length).toBe(1);
    expect(received[0].map((m) => m.label).sort()).toEqual([a.label, b.label].sort());

    // a dream node exists with metadata.dream===true + consolidatedFrom of the two source ids
    const dreams = (await h.db.select().from(memoryNodes).where(eq(memoryNodes.orgId, "o1")))
      .filter((n) => (n.metadata as { dream?: boolean }).dream === true);
    expect(dreams.length).toBe(1);
    expect(dreams[0].label).toBe("FAKE LABEL");
    expect(dreams[0].body).toBe("FAKE BODY");
    expect((dreams[0].metadata as { consolidatedFrom?: string[] }).consolidatedFrom!.sort()).toEqual([a.id, b.id].sort());

    // two `consolidates` edges from the dream node to its sources
    const edges = await h.db.select().from(memoryEdges).where(and(eq(memoryEdges.orgId, "o1"), eq(memoryEdges.relation, "consolidates")));
    expect(edges.length).toBe(2);
    expect(edges.every((e) => e.fromId === dreams[0].id)).toBe(true);
    expect(edges.map((e) => e.toId).sort()).toEqual([a.id, b.id].sort());

    // org-B was never touched
    expect((await h.db.select().from(memoryEdges).where(eq(memoryEdges.orgId, "o2"))).length).toBe(0);

    // idempotent: a SECOND consolidate creates nothing new (deterministic id)
    const r2 = await consolidate(h.db, "o1", { synthesize: fake });
    expect(r2).toEqual({ created: 0, clusters: 1 });
    const dreams2 = (await h.db.select().from(memoryNodes).where(eq(memoryNodes.orgId, "o1")))
      .filter((n) => (n.metadata as { dream?: boolean }).dream === true);
    expect(dreams2.length).toBe(1);
  });

  it("uses defaultSynthesize heuristic when no synthesizer injected", async () => {
    await createNode(h.db, { orgId: "o1", kind: "decision", label: "postgres listen notify realtime" });
    await createNode(h.db, { orgId: "o1", kind: "decision", label: "realtime notify via postgres" });
    const r = await consolidate(h.db, "o1");
    expect(r.created).toBe(1);
    const dreams = (await h.db.select().from(memoryNodes).where(eq(memoryNodes.orgId, "o1")))
      .filter((n) => (n.metadata as { dream?: boolean }).dream === true);
    expect(dreams[0].label.startsWith("Consolidated:")).toBe(true);
  });
});

describe("defaultSynthesize", () => {
  it("produces a higher-order summary referencing each member", () => {
    const out = defaultSynthesize([
      { kind: "decision", label: "Use Postgres", body: "for realtime" },
      { kind: "fact", label: "scrypt", body: "" },
    ]);
    expect(out.label.startsWith("Consolidated:")).toBe(true);
    expect(out.body).toContain("- (decision) Use Postgres: for realtime");
    expect(out.body).toContain("- (fact) scrypt");
  });
});
