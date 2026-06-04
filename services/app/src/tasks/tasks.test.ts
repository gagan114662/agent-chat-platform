import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { openTaskForMention, transitionRun, reassignTask, updateTask, addTaskComment, listTaskComments, addTaskRelation, listTaskRelations, bulkCreateTasks } from "./tasks.js";
import { orgs, workspaces, channels, threads, agents, runs, tasks } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "Org" });
  await h.db.insert(orgs).values({ id: "o2", name: "Org B" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "WS" });
  await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "WS B" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "g" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T", repoId: "r1" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "C", adapter: "fake", config: {} });
  await h.db.insert(agents).values({ id: "a2", orgId: "o1", workspaceId: "w1", handle: "reviewer", displayName: "Reviewer", adapter: "fake", config: {} });
  await h.db.insert(agents).values({ id: "b2", orgId: "o2", workspaceId: "w2", handle: "intruder", displayName: "Intruder", adapter: "fake", config: {} });
  // org-B thread for bulk-create + cross-org isolation checks (#81).
  await h.db.insert(channels).values({ id: "c2", orgId: "o2", workspaceId: "w2", name: "g" });
  await h.db.insert(threads).values({ id: "t2", orgId: "o2", channelId: "c2", title: "T B" });
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
    const running = await transitionRun(h.db, run.id, "running", {}, "o1");
    expect(running.state).toBe("running");
    const merged = await transitionRun(h.db, run.id, "merged", { prNumber: 7, prUrl: "u", commitSha: "s", branch: "b" }, "o1");
    expect(merged.state).toBe("merged");
    expect(merged.prNumber).toBe(7);
    await expect(transitionRun(h.db, run.id, "running", {}, "o1")).rejects.toThrow(/illegal transition/);
  });

  it("transitionRun ignores a run from another org (cross-tenant IDOR)", async () => {
    const { run } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "x", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    // org B tries to transition org A's run by id → run not found, state unchanged
    await expect(transitionRun(h.db, run.id, "running", {}, "o2")).rejects.toThrow(/run not found/);
  });
});

describe("reassignTask", () => {
  it("hands a task to another in-org agent + creates a fresh pending run", async () => {
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    const { task: reassigned, run } = await reassignTask(h.db, {
      orgId: "o1", taskId: task.id, agentId: "a2", byKind: "human", byId: "m1",
    });
    expect(reassigned.assigneeKind).toBe("agent");
    expect(reassigned.assigneeId).toBe("a2");
    expect(reassigned.state).toBe("in_progress");
    expect(run.state).toBe("pending");
    expect(run.taskId).toBe(task.id);
    expect(run.workflowId).toBe(`run-${run.id}`);
    // a fresh run row exists for the task (original + new)
    const all = await h.db.select().from(runs).where(eq(runs.taskId, task.id));
    expect(all.length).toBe(2);
  });

  it("rejects a cross-org agent (cross-tenant IDOR)", async () => {
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    await expect(reassignTask(h.db, {
      orgId: "o1", taskId: task.id, agentId: "b2", byKind: "human", byId: "m1",
    })).rejects.toThrow(/agent not found/);
  });

  it("rejects reassigning a task owned by another org (cross-tenant IDOR)", async () => {
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "fix bug", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    // org B tries to reassign org A's task by id → task not found
    await expect(reassignTask(h.db, {
      orgId: "o2", taskId: task.id, agentId: "b2", byKind: "human", byId: "m1",
    })).rejects.toThrow(/task not found/);
  });
});

// #81 richer tasks: priority/due/status, comments, relations, bulk create.
describe("updateTask", () => {
  async function seedTask() {
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "x", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    return task;
  }

  it("sets priority, due date and state (partial update, org-scoped)", async () => {
    const task = await seedTask();
    const due = new Date("2026-07-01T00:00:00.000Z");
    const updated = await updateTask(h.db, {
      orgId: "o1", taskId: task.id, priority: "high", dueDate: due, state: "in_review",
    });
    expect(updated.priority).toBe("high");
    expect(updated.state).toBe("in_review");
    expect(updated.dueDate?.toISOString()).toBe(due.toISOString());

    // partial: changing only priority leaves state/due untouched
    const onlyPrio = await updateTask(h.db, { orgId: "o1", taskId: task.id, priority: "urgent" });
    expect(onlyPrio.priority).toBe("urgent");
    expect(onlyPrio.state).toBe("in_review");
  });

  it("keeps `open` a valid state value (backward-compat)", async () => {
    const task = await seedTask();
    const updated = await updateTask(h.db, { orgId: "o1", taskId: task.id, state: "open" });
    expect(updated.state).toBe("open");
  });

  it("rejects an invalid state or priority", async () => {
    const task = await seedTask();
    await expect(updateTask(h.db, { orgId: "o1", taskId: task.id, state: "nope" as any }))
      .rejects.toThrow(/invalid state/);
    await expect(updateTask(h.db, { orgId: "o1", taskId: task.id, priority: "critical" as any }))
      .rejects.toThrow(/invalid priority/);
  });

  it("rejects updating a task owned by another org (cross-tenant IDOR)", async () => {
    const task = await seedTask();
    await expect(updateTask(h.db, { orgId: "o2", taskId: task.id, state: "done" }))
      .rejects.toThrow(/task not found/);
  });
});

describe("task comments", () => {
  it("adds a comment and lists it (org-scoped); rejects cross-org task", async () => {
    const { task } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "x", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    const c = await addTaskComment(h.db, {
      orgId: "o1", taskId: task.id, authorKind: "human", authorId: "m1", body: "first comment",
    });
    expect(c.body).toBe("first comment");
    const list = await listTaskComments(h.db, "o1", task.id);
    expect(list.length).toBe(1);
    expect(list[0].authorId).toBe("m1");

    await expect(addTaskComment(h.db, {
      orgId: "o2", taskId: task.id, authorKind: "human", authorId: "x", body: "nope",
    })).rejects.toThrow(/task not found/);
  });
});

describe("task relations", () => {
  it("links two tasks, is idempotent, and lists from both ends", async () => {
    const { task: a } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "A", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    const { task: b } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "B", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    const r1 = await addTaskRelation(h.db, { orgId: "o1", fromTaskId: a.id, toTaskId: b.id, relation: "blocks" });
    // idempotent: re-add returns the same row
    const r2 = await addTaskRelation(h.db, { orgId: "o1", fromTaskId: a.id, toTaskId: b.id, relation: "blocks" });
    expect(r2.id).toBe(r1.id);

    // listed from the `from` end and from the `to` end
    expect((await listTaskRelations(h.db, "o1", a.id)).length).toBe(1);
    expect((await listTaskRelations(h.db, "o1", b.id)).length).toBe(1);
  });

  it("rejects a cross-org task id", async () => {
    const { task: a } = await openTaskForMention(h.db, {
      orgId: "o1", threadId: "t1", intent: "A", agentId: "a1", createdByKind: "human", createdById: "m1",
    });
    await expect(addTaskRelation(h.db, {
      orgId: "o1", fromTaskId: a.id, toTaskId: "ghost", relation: "related",
    })).rejects.toThrow(/task not found/);
  });
});

describe("bulkCreateTasks", () => {
  it("creates 3 tasks in one transaction (org-scoped) and 51 throws", async () => {
    const items = [
      { title: "one", priority: "high" as const },
      { title: "two", dueDate: "2026-08-01T00:00:00.000Z" },
      { title: "three" },
    ];
    const { ids } = await bulkCreateTasks(h.db, {
      orgId: "o1", threadId: "t1", items, byKind: "human", byId: "m1",
    });
    expect(ids.length).toBe(3);
    const rows = await h.db.select().from(tasks).where(eq(tasks.orgId, "o1"));
    expect(rows.length).toBe(3);
    expect(rows.find((r) => r.title === "one")?.priority).toBe("high");
    expect(rows.find((r) => r.title === "three")?.state).toBe("backlog");

    const tooMany = Array.from({ length: 51 }, (_, n) => ({ title: `t${n}` }));
    await expect(bulkCreateTasks(h.db, {
      orgId: "o1", threadId: "t1", items: tooMany, byKind: "human", byId: "m1",
    })).rejects.toThrow(/too many items/);
  });

  it("isolates orgs (org-B bulk does not appear for org-A)", async () => {
    await bulkCreateTasks(h.db, {
      orgId: "o2", threadId: "t2", items: [{ title: "b-only" }], byKind: "human", byId: "m9",
    });
    const aRows = await h.db.select().from(tasks).where(eq(tasks.orgId, "o1"));
    expect(aRows.length).toBe(0);
    const bRows = await h.db.select().from(tasks).where(eq(tasks.orgId, "o2"));
    expect(bRows.length).toBe(1);
  });
});
