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

  it("attaches parentRunId to the outcome (pr_card) metadata when the run is stacked (#53)", async () => {
    const { run } = await seedRun();
    const sink = makeFusionSink(h.db, h.sql, { orgId: "o1", threadId: "t1", runId: run.id, agentId: "a1", parentRunId: "r-parent" });
    await sink({ type: "sandbox_started" });
    await sink({ type: "outcome", outcome: "merged", prNumber: 7, prUrl: "u", commitSha: "s" });
    const msgs = await listMessages(h.db, "t1", "o1");
    expect(msgs.at(-1)?.kind).toBe("pr_card");
    expect((msgs.at(-1)?.metadata as any).parentRunId).toBe("r-parent");
  });

  it("omits parentRunId from outcome metadata for a flat (non-stacked) run", async () => {
    const { run } = await seedRun();
    const sink = makeFusionSink(h.db, h.sql, { orgId: "o1", threadId: "t1", runId: run.id, agentId: "a1" });
    await sink({ type: "sandbox_started" });
    await sink({ type: "outcome", outcome: "merged", prNumber: 7, prUrl: "u", commitSha: "s" });
    const msgs = await listMessages(h.db, "t1", "o1");
    expect((msgs.at(-1)?.metadata as any).parentRunId).toBeUndefined();
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

  it("renders plan_proposed as a plan_card and parks at awaiting_plan_approval (#20)", async () => {
    const { run } = await seedRun();
    const sink = makeFusionSink(h.db, h.sql, { orgId: "o1", threadId: "t1", runId: run.id, agentId: "a1" });
    await sink({ type: "plan_proposed", plan: "1. step one\n2. step two" });
    await sink({ type: "outcome", outcome: "awaiting_plan" });

    const msgs = await listMessages(h.db, "t1", "o1");
    const plan = msgs.find((m) => m.kind === "plan_card");
    expect(plan).toBeTruthy();
    expect(plan?.body).toContain("step one");
    expect((plan?.metadata as any).runId).toBe(run.id);
    expect((plan?.metadata as any).kind).toBe("plan");

    const [r] = await h.db.select().from(runs).where(eq(runs.id, run.id));
    expect(r.state).toBe("awaiting_plan_approval");
  });

  it("#98: fires the event-automation hook on outcome with `outcome:<outcome>` (best-effort)", async () => {
    const { run } = await seedRun();
    const events: string[] = [];
    const sink = makeFusionSink(h.db, h.sql, { orgId: "o1", threadId: "t1", runId: run.id, agentId: "a1" }, {
      fireEvents: async (event) => { events.push(event); },
    });
    await sink({ type: "sandbox_started" });
    await sink({ type: "outcome", outcome: "checks_failed", prNumber: 7, prUrl: "u" });
    expect(events).toContain("outcome:checks_failed");
  });

  it("#98: a throwing event-automation hook does not break delivery/transition (guarded)", async () => {
    const { run } = await seedRun();
    const sink = makeFusionSink(h.db, h.sql, { orgId: "o1", threadId: "t1", runId: run.id, agentId: "a1" }, {
      fireEvents: async () => { throw new Error("boom"); },
    });
    await sink({ type: "sandbox_started" });
    // Must not throw even though the hook throws.
    await sink({ type: "outcome", outcome: "merged", prNumber: 7, prUrl: "u", commitSha: "s" });
    // The transition still happened and the message was still delivered.
    const [r] = await h.db.select().from(runs).where(eq(runs.id, run.id));
    expect(r.state).toBe("merged");
    const msgs = await listMessages(h.db, "t1", "o1");
    expect(msgs.at(-1)?.kind).toBe("pr_card");
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
