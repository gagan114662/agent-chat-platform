import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerAuth } from "./auth-routes.js";
import { registerInviteRoutes } from "./invite-routes.js";
import { _reset } from "../auth/rate-limit.js";
import { orgs, workspaces, members } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerAuth(app, { db: h.db });
  registerInviteRoutes(app, { db: h.db });
  return app;
}

beforeEach(async () => {
  _reset();
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O2" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
  await h.db.insert(members).values({ id: "adm", orgId: "o1", workspaceId: "w1", displayName: "Admin", role: "admin" });
  await h.db.insert(members).values({ id: "reg", orgId: "o1", workspaceId: "w1", displayName: "Reg", role: "member" });
  await h.db.insert(members).values({ id: "adm2", orgId: "o2", workspaceId: "w2", displayName: "Admin2", role: "admin" });
});

const admin = { "x-org-id": "o1", "x-user-id": "adm", "content-type": "application/json" };
const member = { "x-org-id": "o1", "x-user-id": "reg", "content-type": "application/json" };

describe("invite + member-directory routes (#88)", () => {
  it("POST /invites (admin) returns an inv_ token once + 201", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/invites", headers: admin, payload: { email: "a@x.io" } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toMatch(/^inv_/);
    expect(body.invite.id).toBeTruthy();
    expect(body.invite.email).toBe("a@x.io");
    expect(JSON.stringify(body.invite)).not.toContain("tokenHash");
    await app.close();
  });

  it("POST /invites/accept (public) provisions a member that can then log in", async () => {
    const app = makeApp();
    const inv = await app.inject({ method: "POST", url: "/invites", headers: admin, payload: { email: "a@x.io" } });
    const token = inv.json().token as string;

    // accept is public — no session/dev headers required
    const acc = await app.inject({ method: "POST", url: "/invites/accept", headers: { "content-type": "application/json" }, payload: { token, displayName: "Ada", password: "pw" } });
    expect(acc.statusCode).toBe(201);
    const memberId = acc.json().member.id as string;
    expect(acc.json().member.orgId).toBe("o1");
    expect(JSON.stringify(acc.json())).not.toContain("passwordHash");

    // the provisioned member can log in with the password
    const login = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: { memberId, password: "pw" } });
    expect(login.statusCode).toBe(201);
    await app.close();
  });

  it("POST /invites/accept with a bad token → 400", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/invites/accept", headers: { "content-type": "application/json" }, payload: { token: "inv_nope", displayName: "X" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid invite");
    await app.close();
  });

  it("POST /invites as a non-admin (member) → 403", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/invites", headers: member, payload: { email: "a@x.io" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("GET /invites (admin) lists pending invites without secrets", async () => {
    const app = makeApp();
    const inv = await app.inject({ method: "POST", url: "/invites", headers: admin, payload: { email: "a@x.io" } });
    const token = inv.json().token as string;
    const list = await app.inject({ method: "GET", url: "/invites", headers: { "x-org-id": "o1", "x-user-id": "adm" } });
    expect(list.statusCode).toBe(200);
    const rows = list.json();
    expect(rows.map((i: { email: string }) => i.email)).toContain("a@x.io");
    expect(JSON.stringify(rows)).not.toContain("tokenHash");
    expect(JSON.stringify(rows)).not.toContain("token_hash");
    expect(JSON.stringify(rows)).not.toContain(token);
    await app.close();
  });

  it("GET /invites as a non-admin → 403", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/invites", headers: member });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("DELETE /invites/:id revokes (admin); cross-org revoke → 404", async () => {
    const app = makeApp();
    const inv = await app.inject({ method: "POST", url: "/invites", headers: admin, payload: { email: "a@x.io" } });
    const id = inv.json().invite.id as string;
    const token = inv.json().token as string;

    // o2 admin can't see o1's invite → 404
    const cross = await app.inject({ method: "DELETE", url: `/invites/${id}`, headers: { "x-org-id": "o2", "x-user-id": "adm2" } });
    expect(cross.statusCode).toBe(404);

    // o1 admin revokes → 204, and the invite can no longer be accepted
    const del = await app.inject({ method: "DELETE", url: `/invites/${id}`, headers: { "x-org-id": "o1", "x-user-id": "adm" } });
    expect(del.statusCode).toBe(204);
    const acc = await app.inject({ method: "POST", url: "/invites/accept", headers: { "content-type": "application/json" }, payload: { token, displayName: "Ada" } });
    expect(acc.statusCode).toBe(400);
    await app.close();
  });

  it("GET /members lists the org directory without password hashes", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/members", headers: { "x-org-id": "o1", "x-user-id": "adm" } });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    const ids = rows.map((m: { id: string }) => m.id);
    expect(ids).toContain("adm");
    expect(ids).toContain("reg");
    expect(ids).not.toContain("adm2"); // org-scoped — o2's admin not listed
    expect(JSON.stringify(rows)).not.toContain("passwordHash");
    expect(JSON.stringify(rows)).not.toContain("password_hash");
    // shape: id, displayName, role, workspaceId
    expect(rows[0]).toHaveProperty("displayName");
    expect(rows[0]).toHaveProperty("role");
    expect(rows[0]).toHaveProperty("workspaceId");
    await app.close();
  });

  it("seat-limit reached (ACP_SEAT_LIMIT=0) blocks the invite", async () => {
    const prev = process.env.ACP_SEAT_LIMIT;
    process.env.ACP_SEAT_LIMIT = "0";
    try {
      const app = makeApp();
      const res = await app.inject({ method: "POST", url: "/invites", headers: admin, payload: { email: "a@x.io" } });
      expect([400, 402]).toContain(res.statusCode);
      expect(res.json().error).toMatch(/seat limit/i);
      await app.close();
    } finally {
      if (prev === undefined) delete process.env.ACP_SEAT_LIMIT;
      else process.env.ACP_SEAT_LIMIT = prev;
    }
  });
});
