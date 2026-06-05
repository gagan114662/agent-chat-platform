import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerAutomationRoutes } from "./automation-routes.js";
import { orgs, workspaces, members, channels, threads, automations } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerAutomationRoutes(app, { db: h.db, sql: h.sql, temporal: {} as any, sandboxUrl: "http://runner:8090", start: async () => {} });
  return app;
}

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "o1", name: "O" }, { id: "o2", name: "O2" }]);
  await h.db.insert(workspaces).values([{ id: "w1", orgId: "o1", name: "W" }, { id: "w2", orgId: "o2", name: "W2" }]);
  await h.db.insert(members).values([
    { id: "adm", orgId: "o1", workspaceId: "w1", displayName: "Admin", role: "admin" },
    { id: "reg", orgId: "o1", workspaceId: "w1", displayName: "Reg", role: "member" },
    { id: "adm2", orgId: "o2", workspaceId: "w2", displayName: "Admin2", role: "admin" },
  ]);
  await h.db.insert(channels).values([{ id: "c1", orgId: "o1", workspaceId: "w1", name: "g" }]);
  await h.db.insert(threads).values([{ id: "t1", orgId: "o1", channelId: "c1", title: "T" }]);
});

const admin = { "x-org-id": "o1", "x-user-id": "adm", "content-type": "application/json" };
const validBody = {
  name: "brief",
  trigger: { type: "schedule", everyMinutes: 60 },
  action: { type: "message", threadId: "t1", body: "hi" },
};

describe("automation routes (#98)", () => {
  it("POST /automations (admin) → 201; GET lists it", async () => {
    const app = makeApp();
    const created = await app.inject({ method: "POST", url: "/automations", headers: admin, payload: validBody });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const list = await app.inject({ method: "GET", url: "/automations", headers: { "x-org-id": "o1" } });
    expect(list.json().map((a: { id: string }) => a.id)).toContain(id);
    await app.close();
  });

  it("POST /automations as a non-admin (member) → 403", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/automations", headers: { "x-org-id": "o1", "x-user-id": "reg", "content-type": "application/json" }, payload: validBody });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("POST /automations with a bad trigger.type → 400", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/automations", headers: admin, payload: { ...validBody, trigger: { type: "nope" } } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /automations with a bad action.type → 400", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/automations", headers: admin, payload: { ...validBody, action: { type: "nope" } } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /automations with a valid slack action → 201 (#100)", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/automations", headers: admin,
      payload: { ...validBody, action: { type: "slack", channel: "#general", text: "deploy done" } },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it("PATCH /automations/:id toggles enabled (admin)", async () => {
    const app = makeApp();
    const created = await app.inject({ method: "POST", url: "/automations", headers: admin, payload: validBody });
    const id = created.json().id as string;
    const patch = await app.inject({ method: "PATCH", url: `/automations/${id}`, headers: admin, payload: { enabled: false } });
    expect(patch.statusCode).toBe(200);
    const [a] = await h.db.select().from(automations);
    expect(a.enabled).toBe(false);
    await app.close();
  });

  it("PATCH another org's automation → 404 (cross-org)", async () => {
    const app = makeApp();
    const created = await app.inject({ method: "POST", url: "/automations", headers: admin, payload: validBody });
    const id = created.json().id as string;
    const res = await app.inject({ method: "PATCH", url: `/automations/${id}`, headers: { "x-org-id": "o2", "x-user-id": "adm2", "content-type": "application/json" }, payload: { enabled: false } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("DELETE /automations/:id (admin) → 204; cross-org → 404", async () => {
    const app = makeApp();
    const created = await app.inject({ method: "POST", url: "/automations", headers: admin, payload: validBody });
    const id = created.json().id as string;
    const cross = await app.inject({ method: "DELETE", url: `/automations/${id}`, headers: { "x-org-id": "o2", "x-user-id": "adm2" } });
    expect(cross.statusCode).toBe(404);
    const del = await app.inject({ method: "DELETE", url: `/automations/${id}`, headers: { "x-org-id": "o1", "x-user-id": "adm" } });
    expect(del.statusCode).toBe(204);
    expect(await h.db.select().from(automations)).toEqual([]);
    await app.close();
  });

  it("GET /automations is org-scoped (does not leak)", async () => {
    const app = makeApp();
    await app.inject({ method: "POST", url: "/automations", headers: admin, payload: validBody });
    const list = await app.inject({ method: "GET", url: "/automations", headers: { "x-org-id": "o2" } });
    expect(list.json()).toEqual([]);
    await app.close();
  });
});
