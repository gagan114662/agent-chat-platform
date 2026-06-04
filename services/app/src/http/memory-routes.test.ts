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
});
