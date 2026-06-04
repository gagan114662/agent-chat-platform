import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerTeamRoutes } from "./team-routes.js";
import { orgs, workspaces, members, agents, teams } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerTeamRoutes(app, { db: h.db });
  return app;
}

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O2" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
  await h.db.insert(members).values({ id: "adm", orgId: "o1", workspaceId: "w1", displayName: "Admin", role: "admin" });
  await h.db.insert(members).values({ id: "reg", orgId: "o1", workspaceId: "w1", displayName: "Reg", role: "member" });
  await h.db.insert(members).values({ id: "vw", orgId: "o1", workspaceId: "w1", displayName: "Viewer", role: "viewer" });
  await h.db.insert(members).values({ id: "adm2", orgId: "o2", workspaceId: "w2", displayName: "Admin2", role: "admin" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "ann", displayName: "Ann" });
});

const admin = { "x-org-id": "o1", "x-user-id": "adm", "content-type": "application/json" };

describe("team routes (#79)", () => {
  it("POST /teams (admin) creates; GET /teams lists it", async () => {
    const app = makeApp();
    const created = await app.inject({ method: "POST", url: "/teams", headers: admin, payload: { name: "backend-team" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const list = await app.inject({ method: "GET", url: "/teams", headers: { "x-org-id": "o1" } });
    expect(list.json().map((t: { id: string }) => t.id)).toContain(id);
    await app.close();
  });

  it("POST /teams as a non-admin (member) is 403", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/teams", headers: { "x-org-id": "o1", "x-user-id": "reg", "content-type": "application/json" }, payload: { name: "x" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("POST /teams as a viewer is 403", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/teams", headers: { "x-org-id": "o1", "x-user-id": "vw", "content-type": "application/json" }, payload: { name: "x" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("POST /teams/:id/members adds an agent; DELETE removes it", async () => {
    const app = makeApp();
    const created = await app.inject({ method: "POST", url: "/teams", headers: admin, payload: { name: "t" } });
    const id = created.json().id as string;
    const add = await app.inject({ method: "POST", url: `/teams/${id}/members`, headers: admin, payload: { memberKind: "agent", memberId: "a1" } });
    expect(add.statusCode).toBe(201);
    const del = await app.inject({ method: "DELETE", url: `/teams/${id}/members/agent/a1`, headers: { "x-org-id": "o1", "x-user-id": "adm" } });
    expect(del.statusCode).toBe(204);
    await app.close();
  });

  it("adding a member to another org's team is 404 (cross-org)", async () => {
    const app = makeApp();
    // create a team in o1
    const [t] = await h.db.insert(teams).values({ id: "tx", orgId: "o1", name: "secret" }).returning();
    // o2 admin tries to add a member to o1's team → the team is invisible (404),
    // not 403 (the actor IS an admin in their own org).
    const res = await app.inject({ method: "POST", url: `/teams/${t.id}/members`, headers: { "x-org-id": "o2", "x-user-id": "adm2", "content-type": "application/json" }, payload: { memberKind: "agent", memberId: "a1" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("GET /teams is org-scoped (does not leak another org's teams)", async () => {
    const app = makeApp();
    await h.db.insert(teams).values({ id: "tx", orgId: "o1", name: "secret" });
    const list = await app.inject({ method: "GET", url: "/teams", headers: { "x-org-id": "o2" } });
    expect(list.json()).toEqual([]);
    await app.close();
  });

  it("non-admin cannot add members either (403)", async () => {
    const app = makeApp();
    await h.db.insert(teams).values({ id: "tx", orgId: "o1", name: "t" });
    const res = await app.inject({ method: "POST", url: "/teams/tx/members", headers: { "x-org-id": "o1", "x-user-id": "reg", "content-type": "application/json" }, payload: { memberKind: "agent", memberId: "a1" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
