import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { makeFusionSink } from "./events.js";
import { listMessages } from "../chat/messages.js";
import { openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, agents, runs, runEvents, tasks } from "../db/schema.js";
import { eq } from "drizzle-orm";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

async function seedRun() {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "g" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T", repoId: "r1" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "C", adapter: "fake", config: {} });
  return openTaskForMention(h.db, { orgId: "o1", threadId: "t1", intent: "x", agentId: "a1", createdByKind: "human", createdById: "m1" });
}

describe("fusion sink", () => {
  it("writes ordered RunEvents + thread messages and transitions on outcome", async () => {
    const { run } = await seedRun();
    const sink = makeFusionSink(h.db, h.sql, { orgId: "o1", threadId: "t1", runId: run.id, agentId: "a1" });
    await sink({ type: "sandbox_started" });
    await sink({ type: "branch_pushed", branch: "b", commitSha: "s" });
    await sink({ type: "pr_opened", prNumber: 7, prUrl: "u" });
    await sink({ type: "checks", status: "pending" });
    await sink({ type: "checks", status: "success" });
    await sink({ type: "outcome", outcome: "merged", prNumber: 7, prUrl: "u", commitSha: "s" });

    const evs = await h.db.select().from(runEvents).where(eq(runEvents.runId, run.id));
    expect(evs.map((e) => e.seq).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);

    const msgs = await listMessages(h.db, "t1", "o1");
    expect(msgs.at(-1)?.kind).toBe("pr_card");
    expect((msgs.at(-1)?.metadata as any).prNumber).toBe(7);
    // The pr_card metadata must carry runId so the UI can call approve/decline.
    expect((msgs.at(-1)?.metadata as any).runId).toBe(run.id);
    expect(msgs.every((m) => m.authorKind === "agent")).toBe(true);

    const [r] = await h.db.select().from(runs).where(eq(runs.id, run.id));
    expect(r.state).toBe("merged");
    const [tk] = await h.db.select().from(tasks).where(eq(tasks.id, r.taskId));
    expect(tk.state).toBe("done");
  });

  it("keeps distinct ci_fix_attempt events separate and renders them", async () => {
    const { run } = await seedRun();
    const sink = makeFusionSink(h.db, h.sql, { orgId: "o1", threadId: "t1", runId: run.id, agentId: "a1" });
    await sink({ type: "ci_fix_attempt", attempt: 1, failure: "ci: lint failed" });
    await sink({ type: "ci_fix_attempt", attempt: 1, failure: "ci: lint failed" }); // replay collapses
    await sink({ type: "ci_fix_attempt", attempt: 2, failure: "ci: test failed" }); // distinct attempt

    const evs = await h.db.select().from(runEvents).where(eq(runEvents.runId, run.id));
    expect(evs.length).toBe(2);

    const msgs = await listMessages(h.db, "t1", "o1");
    const bodies = msgs.map((m) => m.body);
    expect(bodies.some((b) => b.includes("CI fix attempt 1") && b.includes("ci: lint failed"))).toBe(true);
    expect(bodies.some((b) => b.includes("CI fix attempt 2") && b.includes("ci: test failed"))).toBe(true);
  });

  it("is idempotent on replay (same seq not double-written)", async () => {
    const { run } = await seedRun();
    const sink = makeFusionSink(h.db, h.sql, { orgId: "o1", threadId: "t1", runId: run.id, agentId: "a1" });
    await sink({ type: "sandbox_started" });
    await sink({ type: "sandbox_started" });
    const evs = await h.db.select().from(runEvents).where(eq(runEvents.runId, run.id));
    expect(evs.length).toBe(1);
  });
});
