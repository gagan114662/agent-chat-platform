import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { createNode, createEdge, listNodes, neighbors, searchNodes, counts } from "./memory.js";
import { orgs } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); await h.db.insert(orgs).values({ id: "o1", name: "O" }); });

describe("memory", () => {
  it("creates + lists nodes, filtered by kind and scope", async () => {
    await createNode(h.db, { orgId: "o1", kind: "decision", label: "ship it", scope: "team" });
    await createNode(h.db, { orgId: "o1", kind: "fact", label: "uses postgres" });
    expect((await listNodes(h.db, "o1")).length).toBe(2);
    expect((await listNodes(h.db, "o1", { kind: "decision" })).map((n) => n.label)).toEqual(["ship it"]);
    expect((await listNodes(h.db, "o1", { scope: "team" })).length).toBe(1);
    expect((await listNodes(h.db, "o2")).length).toBe(0); // org-scoped
  });
  it("links nodes and walks neighbors (both directions), idempotent edges", async () => {
    const a = await createNode(h.db, { orgId: "o1", kind: "decision", label: "merge PR 7" });
    const b = await createNode(h.db, { orgId: "o1", kind: "identity", label: "coder" });
    await createEdge(h.db, { orgId: "o1", fromId: a.id, toId: b.id, relation: "authored_by" });
    await createEdge(h.db, { orgId: "o1", fromId: a.id, toId: b.id, relation: "authored_by" }); // dup → no-op
    expect((await neighbors(h.db, a.id)).map((n) => n.id)).toEqual([b.id]);
    expect((await neighbors(h.db, b.id)).map((n) => n.id)).toEqual([a.id]);
  });
  it("searches label/body and counts nodes+edges", async () => {
    const a = await createNode(h.db, { orgId: "o1", kind: "fact", label: "login flow", body: "the auth path" });
    const b = await createNode(h.db, { orgId: "o1", kind: "fact", label: "other" });
    await createEdge(h.db, { orgId: "o1", fromId: a.id, toId: b.id, relation: "relates_to" });
    expect((await searchNodes(h.db, "o1", "AUTH")).map((n) => n.id)).toEqual([a.id]);
    expect(await counts(h.db, "o1")).toEqual({ nodes: 2, edges: 1 });
  });
});
