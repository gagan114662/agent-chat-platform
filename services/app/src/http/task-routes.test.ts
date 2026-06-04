import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerTaskRoutes } from "./task-routes.js";
import { openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, agents, repos, runs, messages } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// E2E_GITHUB_TOKEN is the repo's tokenEnvVar below and is left UNSET, so the route
// skips the workflow start — a throwing stub proves temporal is never reached.
const temporalStub = { workflow: { start: async () => { throw new Error("temporal must not be called"); } } } as any;
function makeApp() {
  const app = Fastify();
  registerTaskRoutes(app, { db: h.db, sql: h.sql, temporal: temporalStub, sandboxUrl: "http://runner:8090" });
  return app;
}

beforeEach(async () => {
  delete process.env.E2E_GITHUB_TOKEN;
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O B" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W B" });
  await h.db.insert(repos).values({
    id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "acme", githubName: "app",
    defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN", autonomy: "autopilot-merge",
  });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T", repoId: "r1" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} });
  await h.db.insert(agents).values({ id: "a2", orgId: "o1", workspaceId: "w1", handle: "reviewer", displayName: "Reviewer", adapter: "fake", config: {} });
  await h.db.insert(agents).values({ id: "b2", orgId: "o2", workspaceId: "w2", handle: "intruder", displayName: "Intruder", adapter: "fake", config: {} });
});

describe("POST /tasks/:id/reassign", () => {
  it("hands the task to another agent, creates a new run, and posts a hand-off message (no token → workflow skipped)", async () => {
    const app = makeApp();
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });

    const res = await app.inject({
      method: "POST", url: `/tasks/${task.id}/reassign`,
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: { agentId: "a2" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().task.assigneeId).toBe("a2");
    expect(res.json().run.state).toBe("pending");

    // task reassigned
    const allRuns = await h.db.select().from(runs).where(eq(runs.taskId, task.id));
    expect(allRuns.length).toBe(2); // original + the new hand-off run

    // a "handed off" system message posted by the new agent
    const msgs = await h.db.select().from(messages).where(eq(messages.threadId, "t1"));
    const handoff = msgs.find((m) => m.body.includes("handed off"));
    expect(handoff).toBeDefined();
    expect(handoff!.kind).toBe("system");
    expect(handoff!.authorKind).toBe("agent");
    expect(handoff!.authorId).toBe("a2");
    expect(handoff!.body).toBe("🔁 handed off to Reviewer");

    await app.close();
  });

  it("rejects reassigning another org's task (cross-tenant IDOR) → 404", async () => {
    const app = makeApp();
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    // org B tries to reassign org A's task id → 404, nothing changes
    const res = await app.inject({
      method: "POST", url: `/tasks/${task.id}/reassign`,
      headers: { "x-org-id": "o2", "x-user-id": "m9", "content-type": "application/json" },
      payload: { agentId: "b2" },
    });
    expect(res.statusCode).toBe(404);

    // no extra run, no message written
    const allRuns = await h.db.select().from(runs).where(eq(runs.taskId, task.id));
    expect(allRuns.length).toBe(1);
    const msgs = await h.db.select().from(messages).where(eq(messages.threadId, "t1"));
    expect(msgs.length).toBe(0);
    await app.close();
  });

  it("rejects a cross-org agent (cross-tenant IDOR) → 404", async () => {
    const app = makeApp();
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    const res = await app.inject({
      method: "POST", url: `/tasks/${task.id}/reassign`,
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: { agentId: "b2" }, // org B agent
    });
    expect(res.statusCode).toBe(404);
    const allRuns = await h.db.select().from(runs).where(eq(runs.taskId, task.id));
    expect(allRuns.length).toBe(1);
    await app.close();
  });
});
