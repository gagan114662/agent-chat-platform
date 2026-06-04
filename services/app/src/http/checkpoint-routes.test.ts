import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerCheckpointRoutes } from "./checkpoint-routes.js";
import { recordCheckpoint } from "../fusion/checkpoints.js";
import { orgs, workspaces, channels, threads, agents, repos, runs, tasks, messages } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// A throwing temporal stub: E2E_GITHUB_TOKEN is left UNSET so the route skips the
// workflow start — the stub proves temporal is never reached without a token.
const temporalStub = { workflow: { start: async () => { throw new Error("temporal must not be called"); } } } as any;
function makeApp() {
  const app = Fastify();
  registerCheckpointRoutes(app, { db: h.db, sql: h.sql, temporal: temporalStub, sandboxUrl: "http://runner:8090" });
  return app;
}

// A capturing temporal stub: records the started workflow input so we can assert the
// resolved baseBranch == the checkpoint branch. Used when the repo token IS present.
function makeCapturingApp() {
  const calls: Array<{ workflowId: string; input: any }> = [];
  const temporal = {
    workflow: {
      start: async (_wf: unknown, opts: { workflowId: string; args: any[] }) => {
        calls.push({ workflowId: opts.workflowId, input: opts.args[0] });
      },
    },
  } as any;
  const app = Fastify();
  registerCheckpointRoutes(app, { db: h.db, sql: h.sql, temporal, sandboxUrl: "http://runner:8090" });
  return { app, calls };
}

beforeEach(async () => {
  delete process.env.E2E_GITHUB_TOKEN;
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O B" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(repos).values({
    id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "acme", githubName: "app",
    defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN", autonomy: "autopilot-merge",
  });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T", repoId: "r1" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} });
  await h.db.insert(tasks).values({
    id: "task1", orgId: "o1", threadId: "t1", title: "fix bug", state: "in_progress",
    assigneeKind: "agent", assigneeId: "a1", createdByKind: "human", createdById: "m1",
  });
  await h.db.insert(runs).values({ id: "run1", orgId: "o1", taskId: "task1", state: "merged", workflowId: "run-run1" });
  await recordCheckpoint(h.db, { orgId: "o1", runId: "run1", label: "agent push", branch: "agent/run1", commitSha: "deadbeefcafe" });
});

describe("GET /runs/:id/checkpoints", () => {
  it("lists the run's checkpoints (org-scoped)", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "GET", url: "/runs/run1/checkpoints",
      headers: { "x-org-id": "o1", "x-user-id": "m1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().checkpoints.length).toBe(1);
    expect(res.json().checkpoints[0].branch).toBe("agent/run1");
    expect(res.json().checkpoints[0].commitSha).toBe("deadbeefcafe");
    await app.close();
  });

  it("rejects listing another org's run checkpoints (cross-tenant IDOR) → 404", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "GET", url: "/runs/run1/checkpoints",
      headers: { "x-org-id": "o2", "x-user-id": "m9" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /runs/:id/checkpoints/:cpId/restore", () => {
  it("opens a NEW pending run from the checkpoint, posts a restored message (no token → workflow skipped)", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/runs/run1/checkpoints/run1:cp:deadbeefcafe/restore",
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const newRunId = res.json().run.id;
    expect(res.json().run.state).toBe("pending");
    expect(newRunId).not.toBe("run1");

    // a new pending run exists for the same task
    const allRuns = await h.db.select().from(runs).where(eq(runs.taskId, "task1"));
    expect(allRuns.length).toBe(2); // original + the restored run

    // a "restored from checkpoint" system message posted
    const msgs = await h.db.select().from(messages).where(eq(messages.threadId, "t1"));
    const restored = msgs.find((m) => m.body.includes("restored from checkpoint"));
    expect(restored).toBeDefined();
    expect(restored!.kind).toBe("system");
    expect(restored!.body).toContain("agent push");
    expect(restored!.body).toContain("deadbee");
    await app.close();
  });

  it("starts fusion with baseBranchOverride = the checkpoint branch (token present)", async () => {
    process.env.E2E_GITHUB_TOKEN = "ghp_test";
    const { app, calls } = makeCapturingApp();
    const res = await app.inject({
      method: "POST", url: "/runs/run1/checkpoints/run1:cp:deadbeefcafe/restore",
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const newRunId = res.json().run.id;

    expect(calls.length).toBe(1);
    expect(calls[0].input.baseBranch).toBe("agent/run1"); // = the checkpoint branch
    expect(calls[0].input.branch).toBe(`agent/${newRunId}`);
    expect(calls[0].input.intent).toContain("restored from");
    await app.close();
  });

  it("rejects restoring from another org's run (cross-tenant IDOR) → 404", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/runs/run1/checkpoints/run1:cp:deadbeefcafe/restore",
      headers: { "x-org-id": "o2", "x-user-id": "m9", "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    // no new run created
    const allRuns = await h.db.select().from(runs).where(eq(runs.taskId, "task1"));
    expect(allRuns.length).toBe(1);
    await app.close();
  });

  it("404s when the checkpoint id does not belong to the run", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/runs/run1/checkpoints/run1:cp:nope/restore",
      headers: { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
