import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerRoutes } from "./routes.js";
import { createMessage } from "../chat/messages.js";
import { orgs, workspaces, channels, threads, repos, agents, members } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// temporal is never reached in these tests (no mention / cross-tenant thread is hidden),
// so a throwing stub guards against accidental run starts.
const temporalStub = { workflow: { start: async () => { throw new Error("temporal must not be called"); } } } as any;
function makeApp() {
  const app = Fastify();
  registerRoutes(app, { db: h.db, sql: h.sql, temporal: temporalStub, sandboxUrl: "http://runner:8090" });
  return app;
}

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T" });
});

describe("thread message routes", () => {
  it("GET /threads/:id/messages lists the org's messages", async () => {
    const app = makeApp();
    await createMessage(h.db, { orgId: "o1", threadId: "t1", authorKind: "human", authorId: "m1", body: "hi" });
    const res = await app.inject({ method: "GET", url: "/threads/t1/messages", headers: { "x-org-id": "o1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((m: { body: string }) => m.body)).toEqual(["hi"]);
    await app.close();
  });

  it("GET /threads/:id/messages does not leak another org's messages (cross-tenant IDOR)", async () => {
    const app = makeApp();
    await createMessage(h.db, { orgId: "o1", threadId: "t1", authorKind: "human", authorId: "m1", body: "secret" });
    // org B requests org A's thread id → 404, no message leak
    const res = await app.inject({ method: "GET", url: "/threads/t1/messages", headers: { "x-org-id": "o2" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("POST /threads/:id/messages does not start a run when the thread's repoId belongs to another org (VF-04 org-scope)", async () => {
    // org o1 thread points at a repo OWNED BY org o2 (but sharing workspace w1 so
    // isPermittedOnRepo passes). The org-scoped repo load must return nothing →
    // no run started. Without the fix the repo loads by id and temporalStub throws.
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    await h.db.insert(repos).values({
      id: "rForeign", orgId: "o2", workspaceId: "w1", githubOwner: "o", githubName: "r",
      defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN",
    });
    await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "bot", displayName: "Bot" });
    await h.db.update(threads).set({ repoId: "rForeign" }).where(eq(threads.id, "t1"));
    // Set the foreign repo's token so the only barrier to startFusionRun is the
    // org-scope filter — proving VF-04 rather than the (later) token guard.
    process.env.E2E_GITHUB_TOKEN = "tok";
    const app = makeApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/threads/t1/messages",
        headers: { "x-org-id": "o1", "content-type": "application/json" },
        payload: { body: "@bot please fix" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().startedRuns).toEqual([]);
    } finally {
      delete process.env.E2E_GITHUB_TOKEN;
      await app.close();
    }
  });

  it("POST /threads/:id/messages by a viewer is 403; a member succeeds (#29)", async () => {
    await h.db.insert(members).values({ id: "vw", orgId: "o1", workspaceId: "w1", displayName: "Viewer", role: "viewer" });
    await h.db.insert(members).values({ id: "mb", orgId: "o1", workspaceId: "w1", displayName: "Member", role: "member" });
    const app = makeApp();
    const denied = await app.inject({
      method: "POST", url: "/threads/t1/messages",
      headers: { "x-org-id": "o1", "x-user-id": "vw", "content-type": "application/json" },
      payload: { body: "viewer cannot post" },
    });
    expect(denied.statusCode).toBe(403);
    // nothing written
    const empty = await app.inject({ method: "GET", url: "/threads/t1/messages", headers: { "x-org-id": "o1" } });
    expect(empty.json()).toEqual([]);
    // a member can post
    const ok = await app.inject({
      method: "POST", url: "/threads/t1/messages",
      headers: { "x-org-id": "o1", "x-user-id": "mb", "content-type": "application/json" },
      payload: { body: "member can post" },
    });
    expect(ok.statusCode).toBe(201);
    await app.close();
  });

  it("POST /threads/:id/messages on another org's thread is rejected (cross-tenant IDOR)", async () => {
    const app = makeApp();
    // org B posts to org A's thread id → 404, message not written
    const res = await app.inject({
      method: "POST", url: "/threads/t1/messages",
      headers: { "x-org-id": "o2", "content-type": "application/json" },
      payload: { body: "intrusion" },
    });
    expect(res.statusCode).toBe(404);
    // confirm nothing was written under org B for that thread
    const asOwner = await app.inject({ method: "GET", url: "/threads/t1/messages", headers: { "x-org-id": "o1" } });
    expect(asOwner.json()).toEqual([]);
    await app.close();
  });
});
