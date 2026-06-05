import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { createGoal, decomposeGoal, defaultGoalPlanner, listGoals } from "./goals.js";
import { orgs, workspaces, channels, threads, goals, tasks } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O B" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T" });
});

describe("defaultGoalPlanner", () => {
  it("makes one subtask per non-empty criteria line, stripping list markers", () => {
    const subs = defaultGoalPlanner({ title: "Ship it", criteria: "- a\n* b\n1. c\n\n" });
    expect(subs.map((s) => s.title)).toEqual(["a", "b", "c"]);
  });

  it("falls back to the title when criteria is empty", () => {
    const subs = defaultGoalPlanner({ title: "Just the title", criteria: "" });
    expect(subs.map((s) => s.title)).toEqual(["Just the title"]);
  });
});

describe("createGoal + decomposeGoal", () => {
  it("decomposes a 3-line goal into 3 org-scoped tasks and marks the goal active; second call is idempotent", async () => {
    const goal = await createGoal(h.db, {
      orgId: "o1", title: "Launch", criteria: "do A\ndo B\ndo C", byKind: "human", byId: "m1",
    });
    expect(goal.state).toBe("open");

    const ids = await decomposeGoal(h.db, { orgId: "o1", goalId: goal.id, threadId: "t1" });
    expect(ids.length).toBe(3);

    const createdTasks = await h.db.select().from(tasks).where(eq(tasks.orgId, "o1"));
    expect(createdTasks.length).toBe(3);
    expect(createdTasks.map((t) => t.title).sort()).toEqual(["do A", "do B", "do C"]);
    // all org-scoped + thread-bound + open + planner-created
    for (const t of createdTasks) {
      expect(t.orgId).toBe("o1");
      expect(t.threadId).toBe("t1");
      expect(t.state).toBe("open");
      expect(t.createdByKind).toBe("agent");
      expect(t.createdById).toBe("planner");
    }

    const [after] = await h.db.select().from(goals).where(eq(goals.id, goal.id));
    expect(after.state).toBe("active");

    // idempotent: re-running on a now-active goal creates nothing
    const again = await decomposeGoal(h.db, { orgId: "o1", goalId: goal.id, threadId: "t1" });
    expect(again).toEqual([]);
    const stillThree = await h.db.select().from(tasks).where(eq(tasks.orgId, "o1"));
    expect(stillThree.length).toBe(3);
  });

  it("ignores a goal id from another org (cross-org) → []", async () => {
    const goal = await createGoal(h.db, {
      orgId: "o1", title: "Launch", criteria: "do A", byKind: "human", byId: "m1",
    });
    // org o2 tries to decompose org o1's goal id
    const ids = await decomposeGoal(h.db, { orgId: "o2", goalId: goal.id, threadId: "t1" });
    expect(ids).toEqual([]);
    // o1's goal untouched (still open), no tasks created
    const [g] = await h.db.select().from(goals).where(and(eq(goals.id, goal.id), eq(goals.orgId, "o1")));
    expect(g.state).toBe("open");
    const t = await h.db.select().from(tasks);
    expect(t.length).toBe(0);
  });
});

describe("decomposeGoal assignment + listGoals (#120)", () => {
  it("assigns decomposed tasks to the given agent so the tick can dispatch them", async () => {
    const g = await createGoal(h.db, { orgId: "o1", title: "Launch service", criteria: "build landing\ntake a payment", byKind: "human", byId: "m1" });
    const ids = await decomposeGoal(h.db, { orgId: "o1", goalId: g.id, threadId: "t1", assigneeId: "ag1" });
    expect(ids.length).toBe(2);
    const rows = await h.db.select().from(tasks).where(eq(tasks.orgId, "o1"));
    expect(rows.length).toBe(2);
    expect(rows.every((t) => t.assigneeKind === "agent" && t.assigneeId === "ag1")).toBe(true);
    expect(rows.every((t) => t.state === "open" && t.threadId === "t1")).toBe(true);
  });

  it("leaves tasks unassigned when no agent is given (back-compat)", async () => {
    const g = await createGoal(h.db, { orgId: "o1", title: "Solo", criteria: "do a thing", byKind: "human", byId: "m1" });
    await decomposeGoal(h.db, { orgId: "o1", goalId: g.id, threadId: "t1" });
    const [t] = await h.db.select().from(tasks).where(eq(tasks.orgId, "o1"));
    expect(t.assigneeId).toBeNull();
  });

  it("listGoals returns the org's goals (so they persist across nav)", async () => {
    await createGoal(h.db, { orgId: "o1", title: "G1", byKind: "human", byId: "m1" });
    await createGoal(h.db, { orgId: "o2", title: "Other", byKind: "human", byId: "m2" });
    const gs = await listGoals(h.db, "o1");
    expect(gs.length).toBe(1);
    expect(gs[0].title).toBe("G1");
  });
});
