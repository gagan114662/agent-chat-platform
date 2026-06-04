import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerSelectRoutes } from "./select-routes.js";
import { openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, runs, messages } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerSelectRoutes(app, { db: h.db, sql: h.sql });
  return app;
}

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O B" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T" });
});

describe("POST /runs/:id/select", () => {
  it("marks the chosen run selected and clears its siblings (exclusive)", async () => {
    const app = makeApp();
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    await h.db.insert(runs).values({ id: "rA", orgId: "o1", taskId: task.id, state: "running", workflowId: "run-rA", selected: true });
    await h.db.insert(runs).values({ id: "rB", orgId: "o1", taskId: task.id, state: "running", workflowId: "run-rB" });

    const res = await app.inject({
      method: "POST", url: `/runs/rB/select`,
      headers: { "x-org-id": "o1", "x-user-id": "m1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().run.id).toBe("rB");
    expect(res.json().run.selected).toBe(true);

    const [rA] = await h.db.select().from(runs).where(eq(runs.id, "rA"));
    const [rB] = await h.db.select().from(runs).where(eq(runs.id, "rB"));
    expect(rA.selected).toBe(false); // sibling cleared
    expect(rB.selected).toBe(true);

    // a "selected" system message posted to the task's thread
    const msgs = await h.db.select().from(messages).where(eq(messages.threadId, "t1"));
    const sel = msgs.find((m) => m.body.includes("selected"));
    expect(sel).toBeDefined();
    expect(sel!.kind).toBe("system");

    await app.close();
  });

  it("is idempotent: selecting the same run twice keeps it the exclusive winner", async () => {
    const app = makeApp();
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    await h.db.insert(runs).values({ id: "rA", orgId: "o1", taskId: task.id, state: "running", workflowId: "run-rA" });
    await h.db.insert(runs).values({ id: "rB", orgId: "o1", taskId: task.id, state: "running", workflowId: "run-rB" });

    await app.inject({ method: "POST", url: `/runs/rB/select`, headers: { "x-org-id": "o1", "x-user-id": "m1" } });
    const res2 = await app.inject({ method: "POST", url: `/runs/rB/select`, headers: { "x-org-id": "o1", "x-user-id": "m1" } });
    expect(res2.statusCode).toBe(200);

    const [rA] = await h.db.select().from(runs).where(eq(runs.id, "rA"));
    const [rB] = await h.db.select().from(runs).where(eq(runs.id, "rB"));
    expect(rA.selected).toBe(false);
    expect(rB.selected).toBe(true);
    await app.close();
  });

  it("rejects selecting another org's run → 404", async () => {
    const app = makeApp();
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    await h.db.insert(runs).values({ id: "rA", orgId: "o1", taskId: task.id, state: "running", workflowId: "run-rA" });

    const res = await app.inject({
      method: "POST", url: `/runs/rA/select`,
      headers: { "x-org-id": "o2", "x-user-id": "m9" },
    });
    expect(res.statusCode).toBe(404);
    const [rA] = await h.db.select().from(runs).where(eq(runs.id, "rA"));
    expect(rA.selected).toBe(false); // untouched
    await app.close();
  });
});
