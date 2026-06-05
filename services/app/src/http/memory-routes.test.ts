import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerMemoryRoutes } from "./memory-routes.js";
import { createNode, createEdge } from "../memory/memory.js";
import { orgs, workspaces, members } from "../db/schema.js";

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
  it("POST /memory with scope=org requires admin: member 403, admin 201 (#29)", async () => {
    await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
    await h.db.insert(members).values({ id: "mb", orgId: "o1", workspaceId: "w1", displayName: "Member", role: "member" });
    await h.db.insert(members).values({ id: "adm", orgId: "o1", workspaceId: "w1", displayName: "Admin", role: "admin" });
    const app = makeApp();
    // member creating an org-scoped node → 403
    const denied = await app.inject({
      method: "POST", url: "/memory",
      headers: { "x-org-id": "o1", "x-user-id": "mb", "content-type": "application/json" },
      payload: { kind: "fact", label: "org policy", scope: "org" },
    });
    expect(denied.statusCode).toBe(403);
    // member CAN create a narrower-scoped node
    const okNarrow = await app.inject({
      method: "POST", url: "/memory",
      headers: { "x-org-id": "o1", "x-user-id": "mb", "content-type": "application/json" },
      payload: { kind: "fact", label: "team note", scope: "team" },
    });
    expect(okNarrow.statusCode).toBe(201);
    // admin CAN create an org-scoped node
    const okOrg = await app.inject({
      method: "POST", url: "/memory",
      headers: { "x-org-id": "o1", "x-user-id": "adm", "content-type": "application/json" },
      payload: { kind: "fact", label: "org policy", scope: "org" },
    });
    expect(okOrg.statusCode).toBe(201);
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

  it("POST /memory/nodes/:id/supersede happy-path bumps version; 409 on stale version; cross-org 404", async () => {
    const app = makeApp();
    const old = await createNode(h.db, { orgId: "o1", kind: "fact", label: "v1", body: "old" });
    const ok = await app.inject({
      method: "POST", url: `/memory/nodes/${old.id}/supersede`,
      headers: { "x-org-id": "o1", "content-type": "application/json" },
      payload: { expectedVersion: 1, node: { kind: "fact", label: "v2", body: "new" } },
    });
    expect(ok.statusCode).toBe(201);
    const fresh = ok.json() as { id: string; version: number };
    expect(fresh.version).toBe(2);
    // stale version → 409
    const stale = await app.inject({
      method: "POST", url: `/memory/nodes/${fresh.id}/supersede`,
      headers: { "x-org-id": "o1", "content-type": "application/json" },
      payload: { expectedVersion: 1, node: { kind: "fact", label: "v3" } },
    });
    expect(stale.statusCode).toBe(409);
    // cross-org → 404
    const xorg = await app.inject({
      method: "POST", url: `/memory/nodes/${fresh.id}/supersede`,
      headers: { "x-org-id": "o2", "content-type": "application/json" },
      payload: { expectedVersion: 2, node: { kind: "fact", label: "x" } },
    });
    expect(xorg.statusCode).toBe(404);
    await app.close();
  });

  it("POST /memory/nodes/:id/invalidate hides node from GET /memory and recall; revalidate restores; cross-org 404", async () => {
    const app = makeApp();
    const dec = await createNode(h.db, { orgId: "o1", kind: "decision", label: "Use Postgres LISTEN NOTIFY realtime" });
    // cross-org invalidate → 404, node still active
    const xorg = await app.inject({ method: "POST", url: `/memory/nodes/${dec.id}/invalidate`, headers: { "x-org-id": "o2" } });
    expect(xorg.statusCode).toBe(404);

    const inv = await app.inject({ method: "POST", url: `/memory/nodes/${dec.id}/invalidate`, headers: { "x-org-id": "o1" } });
    expect(inv.statusCode).toBe(200);
    // hidden from GET /memory
    const list = await app.inject({ method: "GET", url: "/memory", headers: { "x-org-id": "o1" } });
    expect(list.json().map((n: { id: string }) => n.id)).not.toContain(dec.id);
    // hidden from recall
    const recall = await app.inject({ method: "GET", url: "/memory/recall?q=realtime%20notify%20postgres", headers: { "x-org-id": "o1" } });
    expect(recall.json().map((n: { id: string }) => n.id)).not.toContain(dec.id);

    // revalidate restores
    const rev = await app.inject({ method: "POST", url: `/memory/nodes/${dec.id}/revalidate`, headers: { "x-org-id": "o1" } });
    expect(rev.statusCode).toBe(200);
    const list2 = await app.inject({ method: "GET", url: "/memory", headers: { "x-org-id": "o1" } });
    expect(list2.json().map((n: { id: string }) => n.id)).toContain(dec.id);
    await app.close();
  });

  it("POST /memory/contradictions creates a contradicts edge", async () => {
    const app = makeApp();
    const a = await createNode(h.db, { orgId: "o1", kind: "fact", label: "round" });
    const b = await createNode(h.db, { orgId: "o1", kind: "fact", label: "flat" });
    const res = await app.inject({
      method: "POST", url: "/memory/contradictions",
      headers: { "x-org-id": "o1", "content-type": "application/json" },
      payload: { fromId: a.id, toId: b.id },
    });
    expect(res.statusCode).toBe(201);
    const nb = await app.inject({ method: "GET", url: `/memory/${a.id}/neighbors`, headers: { "x-org-id": "o1" } });
    expect(nb.json().map((n: { id: string }) => n.id)).toContain(b.id);
    await app.close();
  });

  it("POST /memory accepts derivedFrom and creates a derived_from edge", async () => {
    const app = makeApp();
    const src = await createNode(h.db, { orgId: "o1", kind: "fact", label: "source" });
    const res = await app.inject({
      method: "POST", url: "/memory",
      headers: { "x-org-id": "o1", "content-type": "application/json" },
      payload: { kind: "decision", label: "derived", scope: "team", derivedFrom: [src.id] },
    });
    expect(res.statusCode).toBe(201);
    const newId = (res.json() as { id: string }).id;
    const nb = await app.inject({ method: "GET", url: `/memory/${newId}/neighbors`, headers: { "x-org-id": "o1" } });
    expect(nb.json().map((n: { id: string }) => n.id)).toContain(src.id);
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
