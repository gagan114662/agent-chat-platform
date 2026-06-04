import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerDmRoutes } from "./dm-routes.js";
import { orgs, workspaces, members, agents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
function makeApp() { const app = Fastify(); registerDmRoutes(app, { db: h.db }); return app; }

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "You" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} });
});

describe("dm routes", () => {
  it("GET /principals excludes the actor", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/principals", headers: { "x-org-id": "o1", "x-user-id": "m1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((p: { id: string }) => p.id)).toEqual(["a1"]); // m1 excluded, a1 remains
    await app.close();
  });

  it("POST /dms get-or-creates and GET /dms lists it", async () => {
    const app = makeApp();
    const made = await app.inject({ method: "POST", url: "/dms", headers: { "x-org-id": "o1", "content-type": "application/json" }, payload: { peerKind: "agent", peerId: "a1" } });
    expect(made.statusCode).toBe(201);
    const tid = made.json().id as string;
    const again = await app.inject({ method: "POST", url: "/dms", headers: { "x-org-id": "o1", "content-type": "application/json" }, payload: { peerKind: "agent", peerId: "a1" } });
    expect(again.json().id).toBe(tid); // idempotent
    const list = await app.inject({ method: "GET", url: "/dms", headers: { "x-org-id": "o1" } });
    expect(list.json().map((t: { id: string }) => t.id)).toEqual([tid]);
    await app.close();
  });

  it("POST /dms by a viewer is 403; a member succeeds (#29)", async () => {
    await h.db.insert(members).values({ id: "vw", orgId: "o1", workspaceId: "w1", displayName: "Viewer", role: "viewer" });
    const app = makeApp();
    const denied = await app.inject({
      method: "POST", url: "/dms",
      headers: { "x-org-id": "o1", "x-user-id": "vw", "content-type": "application/json" },
      payload: { peerKind: "agent", peerId: "a1" },
    });
    expect(denied.statusCode).toBe(403);
    // a member (m1, default role) can start a DM
    const ok = await app.inject({
      method: "POST", url: "/dms",
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: { peerKind: "agent", peerId: "a1" },
    });
    expect(ok.statusCode).toBe(201);
    await app.close();
  });

  it("POST /dms with unknown principal 400s", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/dms", headers: { "x-org-id": "o1", "content-type": "application/json" }, payload: { peerKind: "human", peerId: "ghost" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
