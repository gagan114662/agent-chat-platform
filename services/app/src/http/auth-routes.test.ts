import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerAuth } from "./auth-routes.js";
import { orgs, workspaces, members } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
function makeApp() { const app = Fastify(); registerAuth(app, { db: h.db }); return app; }

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "You" });
});

describe("auth routes", () => {
  it("login → me (authed) → logout → me (401)", async () => {
    const app = makeApp();
    const login = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: { memberId: "m1" } });
    expect(login.statusCode).toBe(201);
    const token = login.json().token as string;

    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ orgId: "o1", userId: "m1", role: "member" });

    await app.inject({ method: "POST", url: "/auth/logout", headers: { authorization: `Bearer ${token}` } });
    const me2 = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(me2.statusCode).toBe(401);
    await app.close();
  });

  it("me without a token is 401", async () => {
    const app = makeApp();
    const me = await app.inject({ method: "GET", url: "/auth/me" });
    expect(me.statusCode).toBe(401);
    await app.close();
  });

  it("login with unknown member 400s; /auth/members lists members", async () => {
    const app = makeApp();
    const bad = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: { memberId: "ghost" } });
    expect(bad.statusCode).toBe(400);
    const list = await app.inject({ method: "GET", url: "/auth/members" });
    expect(list.json().map((m: { id: string }) => m.id)).toContain("m1");
    await app.close();
  });

  it("strict mode requires a valid password", async () => {
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      const { hashPassword } = await import("../auth/password.js");
      await h.db.update((await import("../db/schema.js")).members).set({ passwordHash: hashPassword("pw") }).where((await import("drizzle-orm")).eq((await import("../db/schema.js")).members.id, "m1"));
      const app = makeApp();
      const noPw = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: { memberId: "m1" } });
      expect(noPw.statusCode).toBe(401);
      const ok = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: { memberId: "m1", password: "pw" } });
      expect(ok.statusCode).toBe(201);
      await app.close();
    } finally {
      process.env.ACP_ALLOW_DEV_HEADERS = "1";
    }
  });

  it("strict mode rejects unauthenticated requests and hides /auth/members", async () => {
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      const app = makeApp();
      const me = await app.inject({ method: "GET", url: "/auth/me" });
      expect(me.statusCode).toBe(401);
      const members = await app.inject({ method: "GET", url: "/auth/members" });
      expect(members.statusCode).toBe(404);
      // login remains public
      const login = await app.inject({ method: "GET", url: "/auth/login" }); // GET not allowed but path is public → 404 routing, not 401
      expect(login.statusCode).not.toBe(401);
      await app.close();
    } finally {
      process.env.ACP_ALLOW_DEV_HEADERS = "1";
    }
  });
});
