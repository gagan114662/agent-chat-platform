import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs, workspaces, channels, threads, agents, goals, tasks } from "../db/schema.js";
import { createGoal, decomposeGoal, setGoalAutonomy } from "./goals.js";
import { progressGoal } from "./progress.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

async function setup(criteria: string) {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T1" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} });
  const g = await createGoal(h.db, { orgId: "o1", title: "Ship it", criteria, byKind: "human", byId: "m1" });
  await decomposeGoal(h.db, { orgId: "o1", goalId: g.id, threadId: "t1", assigneeId: "a1" });
  await setGoalAutonomy(h.db, "o1", g.id, true);
  return g.id;
}
const setState = (id: string, state: string) => h.db.update(tasks).set({ state }).where(and(eq(tasks.orgId, "o1"), eq(tasks.id, id)));
const goalTasks = () => h.db.select().from(tasks).where(eq(tasks.orgId, "o1"));
const goalRow = (id: string) => h.db.select().from(goals).where(eq(goals.id, id)).then((r) => r[0]);

describe("progressGoal (#138 closed loop)", () => {
  let gid: string;
  beforeEach(async () => { gid = await setup("alpha\nbravo"); });

  it("decompose links tasks to the goal", async () => {
    const ts = await goalTasks();
    expect(ts).toHaveLength(2);
    expect(ts.every((t) => t.goalId === gid)).toBe(true);
  });

  it("stays 'working' while tasks are still open/in-progress", async () => {
    const out = await progressGoal(h.db, "o1", gid);
    expect(out.status).toBe("working");
    expect((await goalRow(gid)).state).toBe("active");
  });

  it("marks the goal DONE when every task is satisfied", async () => {
    for (const t of await goalTasks()) await setState(t.id, "done");
    const out = await progressGoal(h.db, "o1", gid);
    expect(out.status).toBe("done");
    expect((await goalRow(gid)).state).toBe("done");
  });

  it("generates next tasks from the gap when work stalls (some blocked)", async () => {
    const ts = await goalTasks();
    await setState(ts[0].id, "done");
    await setState(ts[1].id, "blocked"); // failed → the gap
    const out = await progressGoal(h.db, "o1", gid);
    expect(out.status).toBe("generated");
    const after = await goalTasks();
    expect(after.length).toBe(3); // one retry task enqueued
    expect(after.some((t) => t.state === "open" && t.title.startsWith("retry: "))).toBe(true);
    expect((await goalRow(gid)).iterations).toBe(1);
  });

  it("#140: a 'live at a public URL' criterion auto-satisfies once the goal has a liveUrl", async () => {
    const id = await setup("Service live at a public URL");
    await h.db.update(goals).set({ liveUrl: "https://shipped.app" }).where(eq(goals.id, id));
    const out = await progressGoal(h.db, "o1", id);
    expect(out.status).toBe("done");
    expect((await goalRow(id)).state).toBe("done");
  });

  it("stops for a human (stuck) after the iteration cap", async () => {
    const ts = await goalTasks();
    await setState(ts[0].id, "done");
    await setState(ts[1].id, "blocked");
    await h.db.update(goals).set({ iterations: 3 }).where(eq(goals.id, gid)); // at cap
    const out = await progressGoal(h.db, "o1", gid);
    expect(out.status).toBe("stuck");
    expect((await goalTasks()).length).toBe(2); // no new tasks generated
  });
});
