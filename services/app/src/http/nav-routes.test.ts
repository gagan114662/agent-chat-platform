import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerNavRoutes } from "./nav-routes.js";
import { orgs, workspaces, channels, repos, members } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerNavRoutes(app, { db: h.db });
  return app;
}

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(repos).values({ id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "o", githubName: "r", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" });
  await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "You", role: "admin" });
  await h.db.insert(members).values({ id: "reg", orgId: "o1", workspaceId: "w1", displayName: "Reg", role: "member" });
});

describe("nav routes", () => {
  it("GET /channels returns org channels", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/channels", headers: { "x-org-id": "o1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((c: { name: string }) => c.name)).toContain("general");
    await app.close();
  });

  it("GET /repos returns org repos", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/repos", headers: { "x-org-id": "o1" } });
    expect(res.json().map((r: { id: string }) => r.id)).toEqual(["r1"]);
    await app.close();
  });

  it("POST /channels/:id/threads creates and GET lists it", async () => {
    const app = makeApp();
    const created = await app.inject({
      method: "POST", url: "/channels/c1/threads",
      headers: { "x-org-id": "o1", "content-type": "application/json" },
      payload: { title: "fix login", repoId: "r1" },
    });
    expect(created.statusCode).toBe(201);
    const tid = created.json().id as string;
    const list = await app.inject({ method: "GET", url: "/channels/c1/threads", headers: { "x-org-id": "o1" } });
    expect(list.json().map((t: { id: string }) => t.id)).toContain(tid);
    await app.close();
  });

  it("GET /channels/:id/threads does not return another org's threads (cross-tenant IDOR)", async () => {
    const app = makeApp();
    const created = await app.inject({
      method: "POST", url: "/channels/c1/threads",
      headers: { "x-org-id": "o1", "content-type": "application/json" },
      payload: { title: "secret", repoId: "r1" },
    });
    expect(created.statusCode).toBe(201);
    // org B requests org A's channel id → must not see the thread
    const list = await app.inject({ method: "GET", url: "/channels/c1/threads", headers: { "x-org-id": "o2" } });
    expect(list.json()).toEqual([]);
    await app.close();
  });

  it("POST with a foreign repo 400s", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/channels/c1/threads",
      headers: { "x-org-id": "o1", "content-type": "application/json" },
      payload: { title: "x", repoId: "does-not-exist" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /channels creates a channel", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/channels",
      headers: { "x-org-id": "o1", "content-type": "application/json" },
      payload: { name: "random" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("random");
    await app.close();
  });

  it("POST /channels/:id/threads by a viewer is 403; a member succeeds (#29)", async () => {
    await h.db.insert(members).values({ id: "vw", orgId: "o1", workspaceId: "w1", displayName: "Viewer", role: "viewer" });
    const app = makeApp();
    const denied = await app.inject({
      method: "POST", url: "/channels/c1/threads",
      headers: { "x-org-id": "o1", "x-user-id": "vw", "content-type": "application/json" },
      payload: { title: "nope", repoId: "r1" },
    });
    expect(denied.statusCode).toBe(403);
    // a member (reg) can still create threads
    const ok = await app.inject({
      method: "POST", url: "/channels/c1/threads",
      headers: { "x-org-id": "o1", "x-user-id": "reg", "content-type": "application/json" },
      payload: { title: "yes", repoId: "r1" },
    });
    expect(ok.statusCode).toBe(201);
    await app.close();
  });

  it("POST /channels as a non-admin is 403", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/channels",
      headers: { "x-org-id": "o1", "x-user-id": "reg", "content-type": "application/json" },
      payload: { name: "nope" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("PATCH /channels/:id renames (admin); non-admin is 403 (#89)", async () => {
    const app = makeApp();
    const ok = await app.inject({
      method: "PATCH", url: "/channels/c1",
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: { name: "renamed" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().name).toBe("renamed");
    const list = await app.inject({ method: "GET", url: "/channels", headers: { "x-org-id": "o1" } });
    expect(list.json().map((c: { name: string }) => c.name)).toContain("renamed");

    const denied = await app.inject({
      method: "PATCH", url: "/channels/c1",
      headers: { "x-org-id": "o1", "x-user-id": "reg", "content-type": "application/json" },
      payload: { name: "nope" },
    });
    expect(denied.statusCode).toBe(403);
    await app.close();
  });

  it("PATCH /channels/:id from another org is 404 (cross-org) (#89)", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
    await h.db.insert(members).values({ id: "m2", orgId: "o2", workspaceId: "w2", displayName: "Other", role: "admin" });
    const app = makeApp();
    // o2 admin tries to rename o1's channel → 404 (org-scoped), not a leak
    const res = await app.inject({
      method: "PATCH", url: "/channels/c1",
      headers: { "x-org-id": "o2", "x-user-id": "m2", "content-type": "application/json" },
      payload: { name: "hijack" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("POST /channels/:id/archive hides it from GET /channels; ?includeArchived=1 shows it (#89)", async () => {
    const app = makeApp();
    const arch = await app.inject({
      method: "POST", url: "/channels/c1/archive",
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: { archived: true },
    });
    expect(arch.statusCode).toBe(200);
    expect(arch.json().archived).toBe(true);

    const def = await app.inject({ method: "GET", url: "/channels", headers: { "x-org-id": "o1" } });
    expect(def.json().map((c: { id: string }) => c.id)).not.toContain("c1");

    const inc = await app.inject({ method: "GET", url: "/channels?includeArchived=1", headers: { "x-org-id": "o1" } });
    expect(inc.json().map((c: { id: string }) => c.id)).toContain("c1");

    // unarchive → visible again
    const un = await app.inject({
      method: "POST", url: "/channels/c1/archive",
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: { archived: false },
    });
    expect(un.statusCode).toBe(200);
    const back = await app.inject({ method: "GET", url: "/channels", headers: { "x-org-id": "o1" } });
    expect(back.json().map((c: { id: string }) => c.id)).toContain("c1");
    await app.close();
  });

  it("POST /channels/:id/archive by a non-admin is 403; cross-org is 404 (#89)", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
    await h.db.insert(members).values({ id: "m2", orgId: "o2", workspaceId: "w2", displayName: "Other", role: "admin" });
    const app = makeApp();
    const denied = await app.inject({
      method: "POST", url: "/channels/c1/archive",
      headers: { "x-org-id": "o1", "x-user-id": "reg", "content-type": "application/json" },
      payload: { archived: true },
    });
    expect(denied.statusCode).toBe(403);
    const cross = await app.inject({
      method: "POST", url: "/channels/c1/archive",
      headers: { "x-org-id": "o2", "x-user-id": "m2", "content-type": "application/json" },
      payload: { archived: true },
    });
    expect(cross.statusCode).toBe(404);
    await app.close();
  });

  it("POST /workspaces/:id/ensure-assistant provisions @iris (admin); non-admin 403; cross-org 404 (#87)", async () => {
    const app = makeApp();
    const ok = await app.inject({
      method: "POST", url: "/workspaces/w1/ensure-assistant",
      headers: { "x-org-id": "o1", "x-user-id": "m1" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().handle).toBe("iris");
    expect(ok.json().adapter).toBe("claude-code");

    // idempotent — second call returns the same agent, no error
    const again = await app.inject({
      method: "POST", url: "/workspaces/w1/ensure-assistant",
      headers: { "x-org-id": "o1", "x-user-id": "m1" },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(ok.json().id);

    // non-admin → 403
    const denied = await app.inject({
      method: "POST", url: "/workspaces/w1/ensure-assistant",
      headers: { "x-org-id": "o1", "x-user-id": "reg" },
    });
    expect(denied.statusCode).toBe(403);

    // cross-org admin → 404 (workspace not in their org)
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
    await h.db.insert(members).values({ id: "m2", orgId: "o2", workspaceId: "w2", displayName: "Other", role: "admin" });
    const cross = await app.inject({
      method: "POST", url: "/workspaces/w1/ensure-assistant",
      headers: { "x-org-id": "o2", "x-user-id": "m2" },
    });
    expect(cross.statusCode).toBe(404);
    await app.close();
  });

  it("GET /search filters by body, org-scoped", async () => {
    const app = makeApp();
    // seed a thread + message to find
    await h.db.insert((await import("../db/schema.js")).threads).values({ id: "ts", orgId: "o1", channelId: "c1", title: "T", createdAt: new Date("2024-01-01T00:00:00Z") });
    await h.db.insert((await import("../db/schema.js")).messages).values({ id: "ms", orgId: "o1", threadId: "ts", authorKind: "human", authorId: "u", kind: "chat", body: "needle here", metadata: {} });
    const hit = await app.inject({ method: "GET", url: "/search?q=needle", headers: { "x-org-id": "o1" } });
    expect(hit.json().map((r: { messageId: string }) => r.messageId)).toEqual(["ms"]);
    const miss = await app.inject({ method: "GET", url: "/search?q=needle", headers: { "x-org-id": "o2" } });
    expect(miss.json()).toEqual([]);
    await app.close();
  });
});
