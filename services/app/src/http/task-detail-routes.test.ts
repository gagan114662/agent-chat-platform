import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerTaskDetailRoutes } from "./task-detail-routes.js";
import { orgs, workspaces, channels, threads, agents, tasks } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerTaskDetailRoutes(app, { db: h.db });
  return app;
}

const HDR = { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" };

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O B" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "g" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "C", adapter: "fake", config: {} });
  await h.db.insert(tasks).values({
    id: "task1", orgId: "o1", threadId: "t1", title: "fix bug", state: "in_progress",
    assigneeKind: "agent", assigneeId: "a1", createdByKind: "human", createdById: "m1",
  });
});

describe("PATCH /tasks/:id", () => {
  it("updates priority/due/state (200)", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "PATCH", url: "/tasks/task1", headers: HDR,
      payload: { priority: "high", state: "in_review", dueDate: "2026-07-01T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().task.priority).toBe("high");
    expect(res.json().task.state).toBe("in_review");
    await app.close();
  });

  it("rejects an invalid state with 400", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "PATCH", url: "/tasks/task1", headers: HDR, payload: { state: "nope" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("404s a cross-org task (IDOR)", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "PATCH", url: "/tasks/task1",
      headers: { ...HDR, "x-org-id": "o2" }, payload: { state: "done" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /tasks/:id/comments + GET /tasks/:id", () => {
  it("adds a comment then GET shows it (with relations)", async () => {
    const app = makeApp();
    const add = await app.inject({
      method: "POST", url: "/tasks/task1/comments", headers: HDR, payload: { body: "looks good" },
    });
    expect(add.statusCode).toBe(201);
    expect(add.json().comment.authorId).toBe("m1");

    const get = await app.inject({ method: "GET", url: "/tasks/task1", headers: HDR });
    expect(get.statusCode).toBe(200);
    expect(get.json().task.id).toBe("task1");
    expect(get.json().comments.length).toBe(1);
    expect(get.json().comments[0].body).toBe("looks good");
    expect(get.json().relations).toEqual([]);
    await app.close();
  });

  it("404s GET on a cross-org task (IDOR)", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "GET", url: "/tasks/task1", headers: { ...HDR, "x-org-id": "o2" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /tasks/:id/relations", () => {
  it("links two tasks (201) and GET shows the relation", async () => {
    await h.db.insert(tasks).values({
      id: "task2", orgId: "o1", threadId: "t1", title: "other", state: "todo",
      createdByKind: "human", createdById: "m1",
    });
    const app = makeApp();
    const rel = await app.inject({
      method: "POST", url: "/tasks/task1/relations", headers: HDR,
      payload: { toTaskId: "task2", relation: "blocks" },
    });
    expect(rel.statusCode).toBe(201);
    expect(rel.json().relation.relation).toBe("blocks");

    const get = await app.inject({ method: "GET", url: "/tasks/task1", headers: HDR });
    expect(get.json().relations.length).toBe(1);
    await app.close();
  });
});

describe("POST /tasks/bulk", () => {
  it("bulk-creates 3 tasks → 3 ids", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/tasks/bulk", headers: HDR,
      payload: { threadId: "t1", items: [{ title: "a" }, { title: "b", priority: "low" }, { title: "c" }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ids.length).toBe(3);
    // org-scoped: the 3 new + the seeded task1 all in o1
    const rows = await h.db.select().from(tasks).where(eq(tasks.orgId, "o1"));
    expect(rows.length).toBe(4);
    await app.close();
  });

  it("rejects 51 items with 400", async () => {
    const app = makeApp();
    const items = Array.from({ length: 51 }, (_, n) => ({ title: `t${n}` }));
    const res = await app.inject({
      method: "POST", url: "/tasks/bulk", headers: HDR, payload: { threadId: "t1", items },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
