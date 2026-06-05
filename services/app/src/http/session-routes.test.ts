import { describe, it, expect, afterAll, afterEach, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerAuth } from "./auth-routes.js";
import { registerSessionRoutes } from "./session-routes.js";
import { _reset } from "../auth/rate-limit.js";
import { createSession } from "../auth/auth.js";
import { orgs, workspaces, members } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerAuth(app, { db: h.db });
  registerSessionRoutes(app, { db: h.db });
  return app;
}

// Run these in STRICT mode (no dev-header fallback) so the bearer token is the
// ONLY thing that authenticates — that's what lets us assert a revoked token
// truly no longer authenticates (with dev headers on, actor() would fall back to
// the x-org-id/x-user-id stub and mask the 401). #37 fail-closed is the default.
beforeEach(async () => {
  delete process.env.ACP_ALLOW_DEV_HEADERS;
  _reset();
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O2" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
  await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "You" });
  await h.db.insert(members).values({ id: "m2", orgId: "o2", workspaceId: "w2", displayName: "Other" });
});

// Restore the dev-header default the rest of the suite (and vitest config) expects.
afterEach(() => { process.env.ACP_ALLOW_DEV_HEADERS = "1"; });

describe("device session routes (#84)", () => {
  it("GET /auth/sessions lists the caller's sessions (no tokens)", async () => {
    const app = makeApp();
    // two logins for m1 → two sessions
    const a = await createSession(h.db, "m1", { userAgent: "Device A" });
    await createSession(h.db, "m1", { userAgent: "Device B" });
    await createSession(h.db, "m2"); // another user's session — must not appear

    const res = await app.inject({ method: "GET", url: "/auth/sessions", headers: { authorization: `Bearer ${a.token}` } });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows.length).toBe(2);
    // the list never carries a bearer secret beyond the session id itself
    expect(JSON.stringify(rows)).not.toContain("memberId");
    expect(JSON.stringify(rows)).not.toContain("member_id");
    expect(rows.map((s: { userAgent: string }) => s.userAgent)).toContain("Device A");
    await app.close();
  });

  it("DELETE /auth/sessions/:id revokes one; that token no longer authenticates", async () => {
    const app = makeApp();
    const a = await createSession(h.db, "m1");
    const b = await createSession(h.db, "m1");

    // a deletes session b
    const del = await app.inject({ method: "DELETE", url: `/auth/sessions/${b.token}`, headers: { authorization: `Bearer ${a.token}` } });
    expect(del.statusCode).toBe(204);

    // b's token no longer authenticates
    const me = await app.inject({ method: "GET", url: "/auth/sessions", headers: { authorization: `Bearer ${b.token}` } });
    expect(me.statusCode).toBe(401);

    // a still works and now lists only itself
    const list = await app.inject({ method: "GET", url: "/auth/sessions", headers: { authorization: `Bearer ${a.token}` } });
    expect(list.json().length).toBe(1);
    await app.close();
  });

  it("DELETE /auth/sessions/:id with another user's session id → 404 (scoped to caller)", async () => {
    const app = makeApp();
    const a = await createSession(h.db, "m1");
    const other = await createSession(h.db, "m2");

    const res = await app.inject({ method: "DELETE", url: `/auth/sessions/${other.token}`, headers: { authorization: `Bearer ${a.token}` } });
    expect(res.statusCode).toBe(404);

    // the foreign session is untouched — still authenticates
    const stillOk = await app.inject({ method: "GET", url: "/auth/sessions", headers: { authorization: `Bearer ${other.token}` } });
    expect(stillOk.statusCode).toBe(200);
    await app.close();
  });

  it("POST /auth/sessions/revoke-others keeps the caller's current session, drops the rest", async () => {
    const app = makeApp();
    const current = await createSession(h.db, "m1");
    const stale1 = await createSession(h.db, "m1");
    const stale2 = await createSession(h.db, "m1");
    const other = await createSession(h.db, "m2");

    const res = await app.inject({ method: "POST", url: "/auth/sessions/revoke-others", headers: { authorization: `Bearer ${current.token}` } });
    expect(res.statusCode).toBe(204);

    // current still authenticates and is the only one left for m1
    const list = await app.inject({ method: "GET", url: "/auth/sessions", headers: { authorization: `Bearer ${current.token}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBe(1);

    // the stale tokens no longer authenticate
    for (const t of [stale1.token, stale2.token]) {
      const dead = await app.inject({ method: "GET", url: "/auth/sessions", headers: { authorization: `Bearer ${t}` } });
      expect(dead.statusCode).toBe(401);
    }
    // another user's session is untouched
    const otherOk = await app.inject({ method: "GET", url: "/auth/sessions", headers: { authorization: `Bearer ${other.token}` } });
    expect(otherOk.statusCode).toBe(200);
    await app.close();
  });
});
