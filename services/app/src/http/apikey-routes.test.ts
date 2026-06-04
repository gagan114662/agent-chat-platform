import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerAuth } from "./auth-routes.js";
import { registerApiKeyRoutes } from "./apikey-routes.js";
import { orgs, workspaces, members } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// The management routes sit behind registerAuth's preHandler. In dev-header mode
// (ACP_ALLOW_DEV_HEADERS=1, set by the test setup) the actor() helper reads
// x-org-id/x-user-id, so admin-gating resolves the role from the DB.
function makeApp() {
  const app = Fastify();
  registerAuth(app, { db: h.db });
  registerApiKeyRoutes(app, { db: h.db });
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
  await h.db.insert(members).values({ id: "adm2", orgId: "o2", workspaceId: "w2", displayName: "Admin2", role: "admin" });
});

const admin = { "x-org-id": "o1", "x-user-id": "adm", "content-type": "application/json" };

describe("api-key routes (#83)", () => {
  it("POST /api-keys (admin) returns an acp_ key once + 201", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/api-keys", headers: admin, payload: { name: "ci", scopes: { channels: ["c1"] } } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key).toMatch(/^acp_/);
    expect(body.id).toBeTruthy();
    expect(body.name).toBe("ci");
    await app.close();
  });

  it("the issued key authenticates as its org principal on a normal route (GET /auth/me)", async () => {
    const app = makeApp();
    const issued = await app.inject({ method: "POST", url: "/api-keys", headers: admin, payload: { name: "ci" } });
    const key = issued.json().key as string;
    const id = issued.json().id as string;

    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${key}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().orgId).toBe("o1");
    expect(me.json().userId).toBe(`apikey:${id}`);
    await app.close();
  });

  it("GET /api-keys lists keys without the secret/hash", async () => {
    const app = makeApp();
    const issued = await app.inject({ method: "POST", url: "/api-keys", headers: admin, payload: { name: "ci" } });
    const key = issued.json().key as string;

    const list = await app.inject({ method: "GET", url: "/api-keys", headers: { "x-org-id": "o1", "x-user-id": "adm" } });
    expect(list.statusCode).toBe(200);
    const rows = list.json();
    expect(rows.map((k: { name: string }) => k.name)).toContain("ci");
    expect(JSON.stringify(rows)).not.toContain("keyHash");
    expect(JSON.stringify(rows)).not.toContain("key_hash");
    expect(JSON.stringify(rows)).not.toContain(key);
    await app.close();
  });

  it("DELETE /api-keys/:id revokes → the key no longer authenticates", async () => {
    const app = makeApp();
    const issued = await app.inject({ method: "POST", url: "/api-keys", headers: admin, payload: { name: "ci" } });
    const key = issued.json().key as string;
    const id = issued.json().id as string;

    const before = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${key}` } });
    expect(before.statusCode).toBe(200);

    const del = await app.inject({ method: "DELETE", url: `/api-keys/${id}`, headers: { "x-org-id": "o1", "x-user-id": "adm" } });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${key}` } });
    expect(after.statusCode).toBe(401);
    await app.close();
  });

  it("POST /api-keys as a non-admin (member) is 403", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/api-keys", headers: { "x-org-id": "o1", "x-user-id": "reg", "content-type": "application/json" }, payload: { name: "x" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("cross-org revoke is 404 (the key is invisible to another org)", async () => {
    const app = makeApp();
    const issued = await app.inject({ method: "POST", url: "/api-keys", headers: admin, payload: { name: "ci" } });
    const key = issued.json().key as string;
    const id = issued.json().id as string;

    // o2 admin tries to revoke o1's key → 404, and the key still authenticates
    const del = await app.inject({ method: "DELETE", url: `/api-keys/${id}`, headers: { "x-org-id": "o2", "x-user-id": "adm2" } });
    expect(del.statusCode).toBe(404);
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${key}` } });
    expect(me.statusCode).toBe(200);
    await app.close();
  });
});
