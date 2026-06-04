import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerFanoutRoutes } from "./fanout-routes.js";
import { openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, agents, repos, runs, messages } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// A capturing temporal stub: records each started workflow so we can assert the
// starter was invoked once per fanned-out agent (with its own agent/<runId> branch).
function makeApp() {
  const calls: Array<{ workflowId: string; input: any }> = [];
  const temporal = {
    workflow: {
      start: async (_wf: unknown, opts: { workflowId: string; args: any[] }) => {
        calls.push({ workflowId: opts.workflowId, input: opts.args[0] });
      },
    },
  } as any;
  const app = Fastify();
  registerFanoutRoutes(app, { db: h.db, sql: h.sql, temporal, sandboxUrl: "http://runner:8090" });
  return { app, calls };
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

describe("POST /tasks/:id/fan-out", () => {
  it("starts one concurrent run per agent (starter called twice) + posts a fanned-out message", async () => {
    process.env.E2E_GITHUB_TOKEN = "ghp_test";
    const { app, calls } = makeApp();
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });

    const res = await app.inject({
      method: "POST", url: `/tasks/${task.id}/fan-out`,
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: { agentIds: ["a1", "a2"] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().runs.length).toBe(2);

    // 2 new runs created (plus the original from openTaskForMention)
    const allRuns = await h.db.select().from(runs).where(eq(runs.taskId, task.id));
    expect(allRuns.length).toBe(3);

    // starter invoked once per agent, each with its own agent/<runId> branch
    expect(calls.length).toBe(2);
    for (const c of calls) {
      expect(c.input.branch).toBe(`agent/${c.input.sink.runId}`);
      expect(c.input.intent).toBe("fix bug");
    }

    // a "fanned out" system message posted
    const msgs = await h.db.select().from(messages).where(eq(messages.threadId, "t1"));
    const fan = msgs.find((m) => m.body.includes("fanned out"));
    expect(fan).toBeDefined();
    expect(fan!.kind).toBe("system");
    expect(fan!.body).toContain("2");

    await app.close();
  });

  it("records runs but skips the workflow start when the repo token is absent", async () => {
    const { app, calls } = makeApp(); // E2E_GITHUB_TOKEN unset
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    const res = await app.inject({
      method: "POST", url: `/tasks/${task.id}/fan-out`,
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: { agentIds: ["a1", "a2"] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().runs.length).toBe(2);
    expect(calls.length).toBe(0); // guarded: no token → no start
    await app.close();
  });

  it("de-duplicates agentIds and skips unknown/cross-org agents", async () => {
    process.env.E2E_GITHUB_TOKEN = "ghp_test";
    const { app, calls } = makeApp();
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    const res = await app.inject({
      method: "POST", url: `/tasks/${task.id}/fan-out`,
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: { agentIds: ["a1", "a1", "b2", "nope"] }, // dup a1, cross-org b2, unknown nope
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().runs.length).toBe(1); // only a1
    expect(calls.length).toBe(1);
    await app.close();
  });

  it("rejects fanning out another org's task → 404", async () => {
    const { app } = makeApp();
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    const res = await app.inject({
      method: "POST", url: `/tasks/${task.id}/fan-out`,
      headers: { "x-org-id": "o2", "x-user-id": "m9", "content-type": "application/json" },
      payload: { agentIds: ["b2"] },
    });
    expect(res.statusCode).toBe(404);
    const allRuns = await h.db.select().from(runs).where(eq(runs.taskId, task.id));
    expect(allRuns.length).toBe(1); // unchanged
    await app.close();
  });
});

describe("GET /tasks/:id/runs", () => {
  it("lists the task's sibling runs (org-scoped)", async () => {
    const { app } = makeApp();
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    await h.db.insert(runs).values({ id: "rx", orgId: "o1", taskId: task.id, state: "running", workflowId: "run-rx", prNumber: 7, prUrl: "http://pr/7" });

    const res = await app.inject({
      method: "GET", url: `/tasks/${task.id}/runs`,
      headers: { "x-org-id": "o1", "x-user-id": "m1" },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json().runs as Array<any>;
    expect(list.length).toBe(2);
    const rx = list.find((r) => r.id === "rx");
    expect(rx.state).toBe("running");
    expect(rx.prNumber).toBe(7);
    expect(rx.selected).toBe(false);
    await app.close();
  });

  it("returns an empty list for another org's task (no leakage)", async () => {
    const { app } = makeApp();
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    const res = await app.inject({
      method: "GET", url: `/tasks/${task.id}/runs`,
      headers: { "x-org-id": "o2", "x-user-id": "m9" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().runs.length).toBe(0);
    await app.close();
  });
});
