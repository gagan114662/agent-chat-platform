import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerAgentRoutes } from "./agent-routes.js";
import { orgs, workspaces, members, agents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
function makeApp() { const app = Fastify(); registerAgentRoutes(app, { db: h.db }); return app; }

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(members).values({ id: "adm", orgId: "o1", workspaceId: "w1", displayName: "Admin", role: "admin" });
  await h.db.insert(members).values({ id: "reg", orgId: "o1", workspaceId: "w1", displayName: "Reg", role: "member" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} });
});

describe("agent routes — PATCH /agents/:id/shared", () => {
  it("an admin can toggle shared on and off", async () => {
    const app = makeApp();
    const on = await app.inject({
      method: "PATCH", url: "/agents/a1/shared",
      headers: { "x-org-id": "o1", "x-user-id": "adm", "content-type": "application/json" },
      payload: { shared: true },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().shared).toBe(true);
    const [after] = await h.db.select().from(agents).where(eq(agents.id, "a1"));
    expect(after.shared).toBe(true);

    const off = await app.inject({
      method: "PATCH", url: "/agents/a1/shared",
      headers: { "x-org-id": "o1", "x-user-id": "adm", "content-type": "application/json" },
      payload: { shared: false },
    });
    expect(off.json().shared).toBe(false);
    await app.close();
  });

  it("a non-admin (member) is 403 and the flag is unchanged", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "PATCH", url: "/agents/a1/shared",
      headers: { "x-org-id": "o1", "x-user-id": "reg", "content-type": "application/json" },
      payload: { shared: true },
    });
    expect(res.statusCode).toBe(403);
    const [after] = await h.db.select().from(agents).where(eq(agents.id, "a1"));
    expect(after.shared).toBe(false);
    await app.close();
  });

  it("toggling an agent in another org is 404 (cross-tenant), and never mutates it", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    await h.db.insert(members).values({ id: "adm2", orgId: "o2", workspaceId: "w1", displayName: "Admin2", role: "admin" });
    const app = makeApp();
    // org o2 admin tries to share org o1's agent → 404
    const res = await app.inject({
      method: "PATCH", url: "/agents/a1/shared",
      headers: { "x-org-id": "o2", "x-user-id": "adm2", "content-type": "application/json" },
      payload: { shared: true },
    });
    expect(res.statusCode).toBe(404);
    const [after] = await h.db.select().from(agents).where(eq(agents.id, "a1"));
    expect(after.shared).toBe(false);
    await app.close();
  });
});

describe("agent routes — PATCH /agents/:id/profile (#91)", () => {
  it("an admin sets avatarUrl + visibility, and GET /agents reflects it", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "PATCH", url: "/agents/a1/profile",
      headers: { "x-org-id": "o1", "x-user-id": "adm", "content-type": "application/json" },
      payload: { avatarUrl: "https://cdn.example/a.png", visibility: "private" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().avatarUrl).toBe("https://cdn.example/a.png");
    expect(res.json().visibility).toBe("private");

    const [after] = await h.db.select().from(agents).where(eq(agents.id, "a1"));
    expect(after.avatarUrl).toBe("https://cdn.example/a.png");
    expect(after.visibility).toBe("private");

    const list = await app.inject({
      method: "GET", url: "/agents",
      headers: { "x-org-id": "o1", "x-user-id": "adm" },
    });
    expect(list.statusCode).toBe(200);
    const a1 = list.json().find((a: { id: string }) => a.id === "a1");
    expect(a1.avatarUrl).toBe("https://cdn.example/a.png");
    expect(a1.visibility).toBe("private");
    await app.close();
  });

  it("rejects an invalid visibility with 400 and does not mutate", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "PATCH", url: "/agents/a1/profile",
      headers: { "x-org-id": "o1", "x-user-id": "adm", "content-type": "application/json" },
      payload: { visibility: "secret" },
    });
    expect(res.statusCode).toBe(400);
    const [after] = await h.db.select().from(agents).where(eq(agents.id, "a1"));
    expect(after.visibility).toBe("public"); // default unchanged
    await app.close();
  });

  it("a non-admin (member) is 403 and the profile is unchanged", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "PATCH", url: "/agents/a1/profile",
      headers: { "x-org-id": "o1", "x-user-id": "reg", "content-type": "application/json" },
      payload: { visibility: "private" },
    });
    expect(res.statusCode).toBe(403);
    const [after] = await h.db.select().from(agents).where(eq(agents.id, "a1"));
    expect(after.visibility).toBe("public");
    await app.close();
  });

  it("setting the profile of an agent in another org is 404 (cross-tenant), and never mutates it", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    await h.db.insert(members).values({ id: "adm2", orgId: "o2", workspaceId: "w1", displayName: "Admin2", role: "admin" });
    const app = makeApp();
    const res = await app.inject({
      method: "PATCH", url: "/agents/a1/profile",
      headers: { "x-org-id": "o2", "x-user-id": "adm2", "content-type": "application/json" },
      payload: { visibility: "private" },
    });
    expect(res.statusCode).toBe(404);
    const [after] = await h.db.select().from(agents).where(eq(agents.id, "a1"));
    expect(after.visibility).toBe("public");
    await app.close();
  });
});
