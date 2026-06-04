import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerNotifyRoutes } from "./notify-routes.js";
import { orgs, workspaces, channels, threads, messages, members } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerNotifyRoutes(app, { db: h.db });
  return app;
}

const T1 = new Date("2024-01-01T00:00:00Z");
const T2 = new Date("2024-01-02T00:00:00Z");
const T3 = new Date("2024-01-03T00:00:00Z");

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "you", role: "admin" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T1", createdAt: T1 });
  await h.db.insert(messages).values([
    { id: "msg1", orgId: "o1", threadId: "t1", authorKind: "human", authorId: "u", kind: "chat", body: "one", createdAt: T1 },
    { id: "msg2", orgId: "o1", threadId: "t1", authorKind: "human", authorId: "u", kind: "chat", body: "two @you look", createdAt: T2 },
    { id: "msg3", orgId: "o1", threadId: "t1", authorKind: "human", authorId: "u", kind: "chat", body: "three", createdAt: T3 },
  ]);
});

describe("notify routes", () => {
  it("GET /unreads reflects all-unread when no read-state", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/unreads", headers: { "x-org-id": "o1", "x-user-id": "m1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().find((c: { threadId: string }) => c.threadId === "t1")?.unread).toBe(3);
    await app.close();
  });

  it("POST /threads/:id/read then GET /unreads reflects it", async () => {
    const app = makeApp();
    const marked = await app.inject({
      method: "POST", url: "/threads/t1/read",
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: { at: T2.toISOString() },
    });
    expect(marked.statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/unreads", headers: { "x-org-id": "o1", "x-user-id": "m1" } });
    expect(res.json().find((c: { threadId: string }) => c.threadId === "t1")?.unread).toBe(1);
    await app.close();
  });

  it("POST /threads/:id/read with no body marks read now (clears unread)", async () => {
    const app = makeApp();
    const marked = await app.inject({
      method: "POST", url: "/threads/t1/read",
      headers: { "x-org-id": "o1", "x-user-id": "m1" },
    });
    expect(marked.statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/unreads", headers: { "x-org-id": "o1", "x-user-id": "m1" } });
    expect(res.json().find((c: { threadId: string }) => c.threadId === "t1")).toBeUndefined();
    await app.close();
  });

  it("POST /threads/:id/read on a cross-org thread → 404", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/threads/t1/read",
      headers: { "x-org-id": "o2", "x-user-id": "mX" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("GET /inbox lists a thread where the member was @mentioned", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/inbox", headers: { "x-org-id": "o1", "x-user-id": "m1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((i: { threadId: string }) => i.threadId)).toContain("t1");
    await app.close();
  });

  it("GET /inbox excludes a mention already read", async () => {
    const app = makeApp();
    await app.inject({
      method: "POST", url: "/threads/t1/read",
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: { at: T2.toISOString() },
    });
    const res = await app.inject({ method: "GET", url: "/inbox", headers: { "x-org-id": "o1", "x-user-id": "m1" } });
    expect(res.json().map((i: { threadId: string }) => i.threadId)).not.toContain("t1");
    await app.close();
  });
});
