import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { tick, type StartRun } from "./tick.js";
import { orgs, workspaces, channels, threads, repos, agents, tasks, runs, incidents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// FAKE temporal: never touched (the injected `start` stands in for startFusionRun),
// so the tick runs with no live Temporal. A throwing client proves it is never reached.
const temporalStub = { workflow: { start: async () => { throw new Error("temporal client must not be called"); } } } as any;

beforeEach(async () => {
  process.env.E2E_GITHUB_TOKEN = "tok"; // repo.tokenEnvVar resolves → ready to dispatch
  await h.reset();
  await h.db.insert(orgs).values([{ id: "o1", name: "O" }, { id: "o2", name: "O B" }]);
  await h.db.insert(workspaces).values([
    { id: "w1", orgId: "o1", name: "W" },
    { id: "w2", orgId: "o2", name: "W B" },
  ]);
  // Org-A autopilot repo (token set), an org-A monitor-only repo, and an org-B repo.
  await h.db.insert(repos).values([
    { id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "acme", githubName: "app", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN", autonomy: "autopilot-merge" },
    { id: "rmon", orgId: "o1", workspaceId: "w1", githubOwner: "acme", githubName: "mon", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN", autonomy: "monitor-only" },
    { id: "rb", orgId: "o2", workspaceId: "w2", githubOwner: "acme", githubName: "b", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN", autonomy: "autopilot-merge" },
  ]);
  await h.db.insert(channels).values([
    { id: "c1", orgId: "o1", workspaceId: "w1", name: "general" },
    { id: "c2", orgId: "o2", workspaceId: "w2", name: "general" },
  ]);
  await h.db.insert(threads).values([
    { id: "t1", orgId: "o1", channelId: "c1", title: "T1", repoId: "r1" },
    { id: "tmon", orgId: "o1", channelId: "c1", title: "Tmon", repoId: "rmon" },
    { id: "tb", orgId: "o2", channelId: "c2", title: "TB", repoId: "rb" },
  ]);
  await h.db.insert(agents).values([
    { id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} },
    { id: "b1", orgId: "o2", workspaceId: "w2", handle: "coderb", displayName: "CoderB", adapter: "fake", config: {} },
  ]);
});

function makeDeps(start: StartRun) {
  return { db: h.db, sql: h.sql, temporal: temporalStub, sandboxUrl: "http://runner:8090", start };
}

describe("tick — observe ready tasks, dispatch within budget", () => {
  it("dispatches up to the budget, sets tasks in_progress with a pending run, and calls the starter once per dispatch", async () => {
    // 3 ready open tasks on the autopilot repo thread, agent-assigned.
    for (const id of ["k1", "k2", "k3"]) {
      await h.db.insert(tasks).values({ id, orgId: "o1", threadId: "t1", title: `do ${id}`, state: "open", assigneeKind: "agent", assigneeId: "a1", createdByKind: "agent", createdById: "planner" });
    }
    const start = vi.fn(async () => {});
    const res = await tick(makeDeps(start), { orgId: "o1", budgetMax: 2 });

    expect(res.dispatched.length).toBe(2);  // budget cap
    expect(start).toHaveBeenCalledTimes(2);  // starter called once per dispatch

    const inProgress = await h.db.select().from(tasks).where(eq(tasks.state, "in_progress"));
    expect(inProgress.length).toBe(2);
    const pending = await h.db.select().from(runs).where(eq(runs.state, "pending"));
    expect(pending.length).toBe(2);
    // the third stays open (budget exhausted), counted as skipped
    const open = await h.db.select().from(tasks).where(eq(tasks.state, "open"));
    expect(open.length).toBe(1);
    expect(res.skipped).toBeGreaterThanOrEqual(1);
  });

  it("skips monitor-only repos, tasks with an existing active run, and non-agent tasks", async () => {
    // ready on autopilot repo
    await h.db.insert(tasks).values({ id: "ready", orgId: "o1", threadId: "t1", title: "ready", state: "open", assigneeKind: "agent", assigneeId: "a1", createdByKind: "agent", createdById: "planner" });
    // monitor-only repo thread → skipped
    await h.db.insert(tasks).values({ id: "mon", orgId: "o1", threadId: "tmon", title: "mon", state: "open", assigneeKind: "agent", assigneeId: "a1", createdByKind: "agent", createdById: "planner" });
    // existing active run → skipped
    await h.db.insert(tasks).values({ id: "hasrun", orgId: "o1", threadId: "t1", title: "hasrun", state: "open", assigneeKind: "agent", assigneeId: "a1", createdByKind: "agent", createdById: "planner" });
    await h.db.insert(runs).values({ id: "existing", orgId: "o1", taskId: "hasrun", state: "running", workflowId: "wf-existing" });
    // not assigned to an agent → skipped
    await h.db.insert(tasks).values({ id: "human", orgId: "o1", threadId: "t1", title: "human", state: "open", assigneeKind: "human", assigneeId: "m1", createdByKind: "human", createdById: "m1" });

    const start = vi.fn(async () => {});
    const res = await tick(makeDeps(start), { orgId: "o1", budgetMax: 5 });

    expect(res.dispatched.length).toBe(1);   // only "ready"
    expect(start).toHaveBeenCalledTimes(1);
    expect(res.skipped).toBe(3);             // mon + hasrun + human

    // monitor-only / has-run / human tasks remain open and untouched
    for (const id of ["mon", "hasrun", "human"]) {
      const [t] = await h.db.select().from(tasks).where(eq(tasks.id, id));
      expect(t.state).toBe("open");
    }
    // the existing run is not duplicated
    const hasrunRuns = await h.db.select().from(runs).where(eq(runs.taskId, "hasrun"));
    expect(hasrunRuns.length).toBe(1);
  });

  it("skips a task whose repo token env var is not set", async () => {
    delete process.env.E2E_GITHUB_TOKEN;
    await h.db.insert(tasks).values({ id: "notok", orgId: "o1", threadId: "t1", title: "notok", state: "open", assigneeKind: "agent", assigneeId: "a1", createdByKind: "agent", createdById: "planner" });
    const start = vi.fn(async () => {});
    const res = await tick(makeDeps(start), { orgId: "o1" });
    expect(res.dispatched.length).toBe(0);
    expect(start).not.toHaveBeenCalled();
  });

  it("also detects + records alerts each iteration (#93): a failed run → alerts >= 1", async () => {
    // a failed run in org-A → the tick's alert pass records one alert-incident
    await h.db.insert(runs).values({ id: "r-cf", orgId: "o1", taskId: "k1-na", state: "checks_failed", workflowId: "wfcf" });
    const start = vi.fn(async () => {});
    const res = await tick(makeDeps(start), { orgId: "o1" });
    expect(res.alerts).toBeGreaterThanOrEqual(1);
    const inc = await h.db.select().from(incidents).where(eq(incidents.orgId, "o1"));
    expect(inc.some((i) => i.source === "alert" && i.id === "o1:run-failed:r-cf")).toBe(true);
  });

  it("does not touch another org's tasks (org-scoped)", async () => {
    // org-A ready task
    await h.db.insert(tasks).values({ id: "a", orgId: "o1", threadId: "t1", title: "a", state: "open", assigneeKind: "agent", assigneeId: "a1", createdByKind: "agent", createdById: "planner" });
    // org-B ready task (different org)
    await h.db.insert(tasks).values({ id: "bt", orgId: "o2", threadId: "tb", title: "bt", state: "open", assigneeKind: "agent", assigneeId: "b1", createdByKind: "agent", createdById: "planner" });

    const start = vi.fn(async () => {});
    const res = await tick(makeDeps(start), { orgId: "o1" });
    expect(res.dispatched.length).toBe(1);   // only org-A

    // org-B task untouched, no run created for it
    const [bt] = await h.db.select().from(tasks).where(eq(tasks.id, "bt"));
    expect(bt.state).toBe("open");
    const bRuns = await h.db.select().from(runs).where(eq(runs.taskId, "bt"));
    expect(bRuns.length).toBe(0);
  });
});
