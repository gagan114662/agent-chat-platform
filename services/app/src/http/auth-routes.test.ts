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

  it("MFA is off by default: login needs no code (#84)", async () => {
    const app = makeApp();
    const login = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: { memberId: "m1" } });
    expect(login.statusCode).toBe(201);
    await app.close();
  });

  it("enroll → confirm → login requires a valid code; wrong/absent code → 401 (#84)", async () => {
    const { totpCode } = await import("../auth/totp.js");
    const app = makeApp();

    // authenticate (dev mode: no password) to call the authed MFA routes
    const login0 = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: { memberId: "m1" } });
    const token0 = login0.json().token as string;

    // enroll → returns a secret (MFA not yet enabled)
    const enroll = await app.inject({ method: "POST", url: "/auth/mfa/enroll", headers: { authorization: `Bearer ${token0}` } });
    expect(enroll.statusCode).toBe(200);
    const secret = enroll.json().secret as string;
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(enroll.json().uri).toContain("otpauth://");

    // confirm enables MFA
    const confirm = await app.inject({ method: "POST", url: "/auth/mfa/confirm", headers: { authorization: `Bearer ${token0}`, "content-type": "application/json" }, payload: { code: totpCode(secret) } });
    expect(confirm.statusCode).toBe(200);

    // now login WITHOUT a code → 401
    const noCode = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: { memberId: "m1" } });
    expect(noCode.statusCode).toBe(401);
    expect(noCode.json().error).toMatch(/mfa/i);

    // login with a WRONG code → 401
    const badCode = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: { memberId: "m1", code: "000000" } });
    expect(badCode.statusCode).toBe(401);

    // login WITH a valid code → 201 session
    const ok = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: { memberId: "m1", code: totpCode(secret) } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().token).toBeTruthy();
    await app.close();
  });

  it("magic-link verify also requires a valid code when MFA is enabled (#84)", async () => {
    const { enrollMfa, confirmMfa } = await import("../auth/mfa.js");
    const { totpCode } = await import("../auth/totp.js");
    const { requestMagicLink } = await import("../auth/magic-link.js");
    // enable MFA directly for m1
    const { secret } = await enrollMfa(h.db, { orgId: "o1", memberId: "m1" });
    await confirmMfa(h.db, { orgId: "o1", memberId: "m1", code: totpCode(secret) });

    const app = makeApp();
    const { token } = await requestMagicLink(h.db, { email: "you@x.io" });
    // verify without a code → 401
    const noCode = await app.inject({ method: "POST", url: "/auth/magic-link/verify", headers: { "content-type": "application/json" }, payload: { token } });
    expect(noCode.statusCode).toBe(401);
    expect(noCode.json().error).toMatch(/mfa/i);
    // verify with a valid code → 200 (token is still unused since the gate runs first)
    const ok = await app.inject({ method: "POST", url: "/auth/magic-link/verify", headers: { "content-type": "application/json" }, payload: { token, code: totpCode(secret) } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().member.id).toBe("m1");
    await app.close();
  });

  it("GET /auth/google → 302 when configured, 400 when not (#84)", async () => {
    const prevId = process.env.GOOGLE_CLIENT_ID;
    const prevRedirect = process.env.GOOGLE_REDIRECT_URI;
    delete process.env.GOOGLE_CLIENT_ID;
    try {
      const app = makeApp();
      // unconfigured → 400 (still a PUBLIC path, not 401)
      const unconf = await app.inject({ method: "GET", url: "/auth/google" });
      expect(unconf.statusCode).toBe(400);

      process.env.GOOGLE_CLIENT_ID = "cid-123";
      process.env.GOOGLE_REDIRECT_URI = "https://app.example.com/auth/google/callback";
      const redir = await app.inject({ method: "GET", url: "/auth/google" });
      expect(redir.statusCode).toBe(302);
      expect(redir.headers.location).toContain("accounts.google.com");
      expect(redir.headers.location).toContain("client_id=cid-123");
      await app.close();
    } finally {
      if (prevId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = prevId;
      if (prevRedirect === undefined) delete process.env.GOOGLE_REDIRECT_URI; else process.env.GOOGLE_REDIRECT_URI = prevRedirect;
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
