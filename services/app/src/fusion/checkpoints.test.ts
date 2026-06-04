import { describe, it, expect, afterAll } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { makeFusionSink } from "./events.js";
import { recordCheckpoint, listCheckpoints } from "./checkpoints.js";
import { openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, agents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

async function seedRun() {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O B" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "g" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T", repoId: "r1" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "C", adapter: "fake", config: {} });
  return openTaskForMention(h.db, { orgId: "o1", threadId: "t1", intent: "x", agentId: "a1", createdByKind: "human", createdById: "m1" });
}

describe("run checkpoints", () => {
  it("captures a checkpoint from branch_pushed and outcome events (distinct shas → 2)", async () => {
    const { run } = await seedRun();
    const sink = makeFusionSink(h.db, h.sql, { orgId: "o1", threadId: "t1", runId: run.id, agentId: "a1" });
    await sink({ type: "sandbox_started" });
    await sink({ type: "branch_pushed", branch: "agent/x", commitSha: "sha-push" });
    await sink({ type: "outcome", outcome: "merged", prNumber: 7, prUrl: "u", commitSha: "sha-merge" });

    const cps = await listCheckpoints(h.db, "o1", run.id);
    expect(cps.length).toBe(2);
    expect(cps[0].label).toBe("agent push");
    expect(cps[0].branch).toBe("agent/x");
    expect(cps[0].commitSha).toBe("sha-push");
    expect(cps[1].label).toBe("outcome:merged");
    expect(cps[1].commitSha).toBe("sha-merge");
    // outcome event carries no branch → falls back to the run's branch (agent/<runId>)
    expect(cps[1].branch).toBe(`agent/${run.id}`);
  });

  it("collapses to one checkpoint when branch_pushed and outcome share the same sha", async () => {
    const { run } = await seedRun();
    const sink = makeFusionSink(h.db, h.sql, { orgId: "o1", threadId: "t1", runId: run.id, agentId: "a1" });
    await sink({ type: "sandbox_started" });
    await sink({ type: "branch_pushed", branch: "agent/x", commitSha: "s" });
    await sink({ type: "outcome", outcome: "merged", prNumber: 7, prUrl: "u", commitSha: "s" });
    const cps = await listCheckpoints(h.db, "o1", run.id);
    expect(cps.length).toBe(1);
  });

  it("is idempotent on event replay (re-feeding the same events adds no checkpoints)", async () => {
    const { run } = await seedRun();
    const ctx = { orgId: "o1", threadId: "t1", runId: run.id, agentId: "a1" };
    const events = [
      { type: "sandbox_started" as const },
      { type: "branch_pushed" as const, branch: "agent/x", commitSha: "sha-push" },
      { type: "outcome" as const, outcome: "merged" as const, prNumber: 7, prUrl: "u", commitSha: "sha-merge" },
    ];
    const sink1 = makeFusionSink(h.db, h.sql, ctx);
    for (const e of events) await sink1(e);
    const sink2 = makeFusionSink(h.db, h.sql, ctx);
    for (const e of events) await sink2(e); // replay
    const cps = await listCheckpoints(h.db, "o1", run.id);
    expect(cps.length).toBe(2);
  });

  it("is org-scoped: org B cannot list org A's checkpoints", async () => {
    const { run } = await seedRun();
    await recordCheckpoint(h.db, { orgId: "o1", runId: run.id, label: "agent push", branch: "agent/x", commitSha: "s" });
    const aSees = await listCheckpoints(h.db, "o1", run.id);
    expect(aSees.length).toBe(1);
    const bSees = await listCheckpoints(h.db, "o2", run.id);
    expect(bSees.length).toBe(0);
  });

  it("recordCheckpoint uses a deterministic id and is idempotent on its own", async () => {
    const { run } = await seedRun();
    const id1 = await recordCheckpoint(h.db, { orgId: "o1", runId: run.id, label: "agent push", branch: "b", commitSha: "abc" });
    const id2 = await recordCheckpoint(h.db, { orgId: "o1", runId: run.id, label: "agent push", branch: "b", commitSha: "abc" });
    expect(id1).toBe(`${run.id}:cp:abc`);
    expect(id2).toBe(id1);
    const cps = await listCheckpoints(h.db, "o1", run.id);
    expect(cps.length).toBe(1);
  });
});
