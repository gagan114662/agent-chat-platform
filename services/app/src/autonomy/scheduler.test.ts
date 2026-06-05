import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs, workspaces, channels, threads, repos, agents, goals, tasks } from "../db/schema.js";
import { createGoal, decomposeGoal, setGoalAutonomy } from "./goals.js";
import { runAutonomyCycle } from "./scheduler.js";
import type { StartRun } from "./tick.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const fakeTemporal = {} as never;
function makeDeps(start: StartRun) {
  return { db: h.db, sql: h.sql, temporal: fakeTemporal, sandboxUrl: "http://sb", start };
}

async function setup() {
  await h.reset();
  process.env.E2E_GITHUB_TOKEN = "tok"; // tick requires the repo token env present
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(repos).values({ id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "acme", githubName: "app", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN", autonomy: "autopilot-merge" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T1", repoId: "r1" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "claude-code", config: {} });
}

describe("runAutonomyCycle (#137 unattended clock)", () => {
  beforeEach(setup);

  it("dispatches an autonomy-ON goal's tasks with NO human Run-now", async () => {
    const g = await createGoal(h.db, { orgId: "o1", title: "G", criteria: "alpha", byKind: "human", byId: "m1" });
    await decomposeGoal(h.db, { orgId: "o1", goalId: g.id, threadId: "t1", assigneeId: "a1" });
    await setGoalAutonomy(h.db, "o1", g.id, true);
    const start = vi.fn(async () => {});
    const res = await runAutonomyCycle(makeDeps(start));
    expect(res.orgs).toBe(1);
    expect(res.dispatched).toBe(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does NOT touch a goal with autonomy OFF (human still drives it)", async () => {
    const g = await createGoal(h.db, { orgId: "o1", title: "G", criteria: "alpha", byKind: "human", byId: "m1" });
    await decomposeGoal(h.db, { orgId: "o1", goalId: g.id, threadId: "t1", assigneeId: "a1" });
    // autonomy left OFF
    const start = vi.fn(async () => {});
    const res = await runAutonomyCycle(makeDeps(start));
    expect(res.orgs).toBe(0);
    expect(start).not.toHaveBeenCalled();
  });

  it("closes the goal once its tasks are satisfied — no further dispatch", async () => {
    const g = await createGoal(h.db, { orgId: "o1", title: "G", criteria: "alpha", byKind: "human", byId: "m1" });
    await decomposeGoal(h.db, { orgId: "o1", goalId: g.id, threadId: "t1", assigneeId: "a1" });
    await setGoalAutonomy(h.db, "o1", g.id, true);
    await h.db.update(tasks).set({ state: "done" }).where(and(eq(tasks.orgId, "o1"), eq(tasks.goalId, g.id)));
    const start = vi.fn(async () => {});
    const res = await runAutonomyCycle(makeDeps(start));
    expect(res.goals[0].outcome.status).toBe("done");
    expect(res.dispatched).toBe(0);
    expect((await h.db.select().from(goals).where(eq(goals.id, g.id)))[0].state).toBe("done");
  });
});
