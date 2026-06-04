import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerMemoryRoutes } from "./memory-routes.js";
import { createNode, createEdge } from "../memory/memory.js";
import { orgs } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
function makeApp() { const app = Fastify(); registerMemoryRoutes(app, { db: h.db }); return app; }
beforeEach(async () => { await h.reset(); await h.db.insert(orgs).values({ id: "o1", name: "O" }); });

describe("memory routes", () => {
  it("POST creates a node; GET lists + filters; stats counts", async () => {
    const app = makeApp();
    const created = await app.inject({ method: "POST", url: "/memory", headers: { "x-org-id": "o1", "content-type": "application/json" }, payload: { kind: "fact", label: "uses postgres" } });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/memory?kind=fact", headers: { "x-org-id": "o1" } });
    expect(list.json().map((n: { label: string }) => n.label)).toContain("uses postgres");
    const stats = await app.inject({ method: "GET", url: "/memory/stats", headers: { "x-org-id": "o1" } });
    expect(stats.json()).toEqual({ nodes: 1, edges: 0 });
    await app.close();
  });
  it("GET /memory/:id/neighbors does not return another org's neighbors (cross-tenant IDOR)", async () => {
    const app = makeApp();
    const a = await createNode(h.db, { orgId: "o1", kind: "decision", label: "merge PR 7" });
    const b = await createNode(h.db, { orgId: "o1", kind: "identity", label: "coder" });
    await createEdge(h.db, { orgId: "o1", fromId: a.id, toId: b.id, relation: "authored_by" });
    // org B walks org A's node id → must be empty
    const res = await app.inject({ method: "GET", url: `/memory/${a.id}/neighbors`, headers: { "x-org-id": "o2" } });
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it("GET /memory/graph returns { nodes, edges }", async () => {
    const app = makeApp();
    const a = await createNode(h.db, { orgId: "o1", kind: "decision", label: "merge PR 7" });
    const b = await createNode(h.db, { orgId: "o1", kind: "identity", label: "coder" });
    await createEdge(h.db, { orgId: "o1", fromId: a.id, toId: b.id, relation: "authored_by" });
    const res = await app.inject({ method: "GET", url: "/memory/graph", headers: { "x-org-id": "o1" } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { nodes: { id: string }[]; edges: { relation: string }[] };
    expect(body.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
    expect(body.edges.map((e) => e.relation)).toEqual(["authored_by"]);
    await app.close();
  });

  it("POST /memory/consolidate dreams over related nodes; is org-scoped and idempotent; dream node visible via GET", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    const app = makeApp();
    await createNode(h.db, { orgId: "o1", kind: "decision", label: "Use Postgres LISTEN NOTIFY realtime" });
    await createNode(h.db, { orgId: "o1", kind: "decision", label: "realtime notify via postgres listen" });
    await createNode(h.db, { orgId: "o1", kind: "fact", label: "scrypt password hashing" });
    // org-B node sharing terms must never be consolidated into org-A
    await createNode(h.db, { orgId: "o2", kind: "decision", label: "Use Postgres LISTEN NOTIFY realtime notify" });

    const res = await app.inject({ method: "POST", url: "/memory/consolidate", headers: { "x-org-id": "o1" } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { created: number; clusters: number };
    expect(body.created).toBeGreaterThanOrEqual(1);
    expect(body.clusters).toBeGreaterThanOrEqual(1);

    // the dream node is visible via GET /memory
    const list = await app.inject({ method: "GET", url: "/memory", headers: { "x-org-id": "o1" } });
    const dreams = (list.json() as { metadata: { dream?: boolean }; orgId: string }[]).filter((n) => n.metadata?.dream === true);
    expect(dreams.length).toBe(1);

    // org B has only one node → no cluster → nothing consolidated
    const oB = await app.inject({ method: "POST", url: "/memory/consolidate", headers: { "x-org-id": "o2" } });
    expect((oB.json() as { created: number }).created).toBe(0);

    // idempotent: second POST creates nothing new
    const again = await app.inject({ method: "POST", url: "/memory/consolidate", headers: { "x-org-id": "o1" } });
    expect((again.json() as { created: number }).created).toBe(0);
    await app.close();
  });

  it("GET /memory/recall returns intent-relevant nodes, org-scoped; missing q → []", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    const app = makeApp();
    await createNode(h.db, { orgId: "o1", kind: "decision", label: "Use Postgres LISTEN/NOTIFY for realtime" });
    await createNode(h.db, { orgId: "o1", kind: "fact", label: "Auth uses scrypt" });
    await createNode(h.db, { orgId: "o2", kind: "decision", label: "Use Postgres LISTEN/NOTIFY realtime auth" });

    const res = await app.inject({ method: "GET", url: "/memory/recall?q=add%20realtime%20notify%20to%20the%20auth%20flow", headers: { "x-org-id": "o1" } });
    expect(res.statusCode).toBe(200);
    const labels = res.json().map((n: { label: string }) => n.label);
    expect(labels).toContain("Use Postgres LISTEN/NOTIFY for realtime");
    expect(labels).toContain("Auth uses scrypt");
    // cross-org isolation: org-B node never appears
    expect(res.json().every((n: { orgId: string }) => n.orgId === "o1")).toBe(true);

    // org B sees none of org A's nodes
    const isolated = await app.inject({ method: "GET", url: "/memory/recall?q=realtime%20notify", headers: { "x-org-id": "o2" } });
    expect(isolated.json().map((n: { label: string }) => n.label)).toEqual(["Use Postgres LISTEN/NOTIFY realtime auth"]);

    // missing q → []
    const empty = await app.inject({ method: "GET", url: "/memory/recall", headers: { "x-org-id": "o1" } });
    expect(empty.json()).toEqual([]);
    await app.close();
  });
});
