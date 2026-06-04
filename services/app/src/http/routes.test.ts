import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerRoutes } from "./routes.js";
import { createMessage } from "../chat/messages.js";
import { orgs, workspaces, channels, threads } from "../db/schema.js";

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
