import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { openTaskForMention, transitionRun } from "./tasks.js";
import { orgs, workspaces, channels, threads, agents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "Org" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "WS" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "g" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T", repoId: "r1" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "C", adapter: "fake", config: {} });
});

describe("tasks", () => {
  it("opens a Task(in_progress) + Run(pending) owned by the agent", async () => {
    const { task, run } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1",
      createdByKind: "human", createdById: "m1",
    });
    expect(task.state).toBe("in_progress");
    expect(task.assigneeKind).toBe("agent");
    expect(task.assigneeId).toBe("a1");
    expect(run.state).toBe("pending");
    expect(run.taskId).toBe(task.id);
    expect(run.workflowId).toBe(`run-${run.id}`);
  });

  it("transitionRun updates state and fields, rejects illegal transitions", async () => {
    const { run } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "x", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    const running = await transitionRun(h.db, run.id, "running", {});
    expect(running.state).toBe("running");
    const merged = await transitionRun(h.db, run.id, "merged", { prNumber: 7, prUrl: "u", commitSha: "s", branch: "b" });
    expect(merged.state).toBe("merged");
    expect(merged.prNumber).toBe(7);
    await expect(transitionRun(h.db, run.id, "running", {})).rejects.toThrow(/illegal transition/);
  });
});
