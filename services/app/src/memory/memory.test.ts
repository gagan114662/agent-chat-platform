import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { createNode, createEdge, listNodes, neighbors, searchNodes, counts, graph, recallForIntent, formatRecall } from "./memory.js";
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
    expect((await neighbors(h.db, a.id, "o1")).map((n) => n.id)).toEqual([b.id]);
    expect((await neighbors(h.db, b.id, "o1")).map((n) => n.id)).toEqual([a.id]);
  });

  it("does not return another org's neighbors via the node id (cross-tenant IDOR)", async () => {
    const a = await createNode(h.db, { orgId: "o1", kind: "decision", label: "merge PR 7" });
    const b = await createNode(h.db, { orgId: "o1", kind: "identity", label: "coder" });
    await createEdge(h.db, { orgId: "o1", fromId: a.id, toId: b.id, relation: "authored_by" });
    // org B walks org A's node id → must be empty
    expect(await neighbors(h.db, a.id, "o2")).toEqual([]);
  });
  it("searches label/body and counts nodes+edges", async () => {
    const a = await createNode(h.db, { orgId: "o1", kind: "fact", label: "login flow", body: "the auth path" });
    const b = await createNode(h.db, { orgId: "o1", kind: "fact", label: "other" });
    await createEdge(h.db, { orgId: "o1", fromId: a.id, toId: b.id, relation: "relates_to" });
    expect((await searchNodes(h.db, "o1", "AUTH")).map((n) => n.id)).toEqual([a.id]);
    expect(await counts(h.db, "o1")).toEqual({ nodes: 2, edges: 1 });
  });
  it("graph returns nodes + only edges among those nodes; kind filter drops dangling edges", async () => {
    const a = await createNode(h.db, { orgId: "o1", kind: "decision", label: "merge PR 7", scope: "team" });
    const b = await createNode(h.db, { orgId: "o1", kind: "identity", label: "coder" });
    await createEdge(h.db, { orgId: "o1", fromId: a.id, toId: b.id, relation: "authored_by" });
    const full = await graph(h.db, "o1");
    expect(full.nodes.length).toBe(2);
    expect(full.edges.map((e) => e.relation)).toEqual(["authored_by"]);
    // filtering by kind narrows nodes and drops the now-dangling edge (b is excluded)
    const narrowed = await graph(h.db, "o1", { kind: "decision" });
    expect(narrowed.nodes.map((n) => n.id)).toEqual([a.id]);
    expect(narrowed.edges).toEqual([]);
  });

  it("recallForIntent returns intent-relevant decision/fact (not artifact), org-scoped", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    const dec = await createNode(h.db, { orgId: "o1", kind: "decision", label: "Use Postgres LISTEN/NOTIFY for realtime" });
    const fact = await createNode(h.db, { orgId: "o1", kind: "fact", label: "Auth uses scrypt" });
    await createNode(h.db, { orgId: "o1", kind: "artifact", label: "realtime notify diagram" });
    // org-B node mentioning the same terms must never leak into org-A recall
    await createNode(h.db, { orgId: "o2", kind: "decision", label: "Use Postgres LISTEN/NOTIFY realtime auth" });

    const hits = await recallForIntent(h.db, "o1", "add realtime notify to the auth flow");
    const ids = hits.map((n) => n.id);
    expect(ids).toContain(dec.id);
    expect(ids).toContain(fact.id);
    // artifact kind excluded by default
    expect(hits.every((n) => n.kind !== "artifact")).toBe(true);
    // the decision hits more terms (realtime + notify) → ranked at/above the fact
    expect(ids.indexOf(dec.id)).toBeLessThanOrEqual(ids.indexOf(fact.id));
    // org-scoped: no org-B node appears
    expect(hits.every((n) => n.orgId === "o1")).toBe(true);
    expect(hits.length).toBe(2);
  });

  it("recallForIntent returns [] for empty or too-short intents", async () => {
    await createNode(h.db, { orgId: "o1", kind: "decision", label: "Use Postgres" });
    expect(await recallForIntent(h.db, "o1", "")).toEqual([]);
    expect(await recallForIntent(h.db, "o1", "a to is of")).toEqual([]); // all terms <4 chars
  });

  it("formatRecall builds a preamble block (or empty string)", async () => {
    expect(formatRecall([])).toBe("");
    const dec = await createNode(h.db, { orgId: "o1", kind: "decision", label: "Use LISTEN/NOTIFY", body: "for realtime" });
    const out = formatRecall([dec]);
    expect(out).toContain("## Relevant prior context");
    expect(out).toContain("- (decision) Use LISTEN/NOTIFY: for realtime");
  });
});
