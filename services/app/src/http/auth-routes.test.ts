import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerAuth } from "./auth-routes.js";
import { _reset } from "../auth/rate-limit.js";
import { orgs, workspaces, members } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
function makeApp() { const app = Fastify(); registerAuth(app, { db: h.db }); return app; }

beforeEach(async () => {
  _reset(); // isolate the in-memory login rate limiter between tests
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "You", email: "you@x.io" });
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

  it("throttles /auth/login: the 6th rapid bad login is 429 (VF-06)", async () => {
    const app = makeApp();
    // 5 bad logins for the same member are allowed (each returns 400 for unknown member)
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: { memberId: "ghost" } });
      expect(res.statusCode).toBe(400);
    }
    // the 6th within the window is rate-limited BEFORE credential checks
    const sixth = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: { memberId: "ghost" } });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toEqual({ error: "too many attempts" });
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

  it("magic-link: request 200 (+dev token) → verify 200 (session) → 401 on reuse (#84)", async () => {
    const app = makeApp();
    const reqRes = await app.inject({ method: "POST", url: "/auth/magic-link/request", headers: { "content-type": "application/json" }, payload: { email: "you@x.io" } });
    expect(reqRes.statusCode).toBe(200);
    // dev headers are on in tests → the token is surfaced once
    const token = reqRes.json().token as string;
    expect(token).toMatch(/^ml_/);
    expect(JSON.stringify(reqRes.json())).not.toContain("tokenHash");

    const ver = await app.inject({ method: "POST", url: "/auth/magic-link/verify", headers: { "content-type": "application/json" }, payload: { token } });
    expect(ver.statusCode).toBe(200);
    const sessionToken = ver.json().token as string;
    expect(ver.json().member.id).toBe("m1");
    // the issued session authenticates
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${sessionToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().userId).toBe("m1");

    // single-use: reusing the magic-link token → 401
    const reuse = await app.inject({ method: "POST", url: "/auth/magic-link/verify", headers: { "content-type": "application/json" }, payload: { token } });
    expect(reuse.statusCode).toBe(401);
    await app.close();
  });

  it("magic-link: request for an unknown email is still 200 with no token (no enumeration) (#84)", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/auth/magic-link/request", headers: { "content-type": "application/json" }, payload: { email: "ghost@x.io" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeUndefined();
    await app.close();
  });

  it("magic-link: verify with a bad token → 401 (#84)", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/auth/magic-link/verify", headers: { "content-type": "application/json" }, payload: { token: "ml_nope" } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("magic-link: in prod (no dev headers) request is 200 but NEVER leaks the token (#84)", async () => {
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      const app = makeApp();
      const res = await app.inject({ method: "POST", url: "/auth/magic-link/request", headers: { "content-type": "application/json" }, payload: { email: "you@x.io" } });
      expect(res.statusCode).toBe(200);
      expect(res.json().token).toBeUndefined();
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
