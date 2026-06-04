import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { approveRun, declineRun } from "./approvals.js";
import { listMessages } from "../chat/messages.js";
import { transitionRun } from "../tasks/tasks.js";
import { openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, agents, repos, runs, tasks } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// Seeds org A with a thread→repo and a held_for_human run (pr #7).
async function seedHeldRun() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(repos).values({
    id: "rA", orgId: "oA", workspaceId: "wA",
    githubOwner: "acme", githubName: "widgets", tokenEnvVar: "GH_TOKEN_TEST",
  });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "g" });
  await h.db.insert(threads).values({ id: "tA", orgId: "oA", channelId: "cA", title: "T", repoId: "rA" });
  await h.db.insert(agents).values({ id: "aA", orgId: "oA", workspaceId: "wA", handle: "coder", displayName: "C", adapter: "fake", config: {} });
  const { run } = await openTaskForMention(h.db, { orgId: "oA", threadId: "tA", intent: "ship it", agentId: "aA", createdByKind: "human", createdById: "mA" });
  // Drive the run to held_for_human with a PR number, as the fusion loop would.
  await transitionRun(h.db, run.id, "running", {}, "oA");
  await transitionRun(h.db, run.id, "held_for_human", { prNumber: 7, prUrl: "https://gh/pr/7", commitSha: "abc1234" }, "oA");
  return run;
}

describe("approvals", () => {
  beforeEach(async () => { await seedHeldRun(); });

  it("approveRun merges the PR, flips run→merged + task→done, posts a pr_card", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    const calls: Array<[string, string, number]> = [];
    const github = { merge: async (owner: string, repo: string, prNumber: number) => { calls.push([owner, repo, prNumber]); } };

    const updated = await approveRun(h.db, github, { orgId: "oA", runId: run.id });

    expect(calls).toEqual([["acme", "widgets", 7]]);
    expect(updated.state).toBe("merged");
    const [task] = await h.db.select().from(tasks).where(eq(tasks.id, run.taskId));
    expect(task.state).toBe("done");
    const msgs = await listMessages(h.db, "tA", "oA");
    const last = msgs.at(-1)!;
    expect(last.kind).toBe("pr_card");
    expect(last.body).toContain("approved & merged");
    expect(last.body).toContain("#7");
  });

  it("cross-org approve is denied (does not merge, does not transition)", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    let merged = false;
    const github = { merge: async () => { merged = true; } };

    await expect(approveRun(h.db, github, { orgId: "oB", runId: run.id })).rejects.toThrow();
    expect(merged).toBe(false);
    const [after] = await h.db.select().from(runs).where(eq(runs.id, run.id));
    expect(after.state).toBe("held_for_human"); // unchanged
  });

  it("approveRun on a non-held run throws", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    await transitionRun(h.db, run.id, "merged", {}, "oA");
    const github = { merge: async () => { throw new Error("should not be called"); } };
    await expect(approveRun(h.db, github, { orgId: "oA", runId: run.id })).rejects.toThrow();
  });

  it("declineRun posts a system message and leaves the run held / task blocked", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    await declineRun(h.db, { orgId: "oA", runId: run.id });

    const [after] = await h.db.select().from(runs).where(eq(runs.id, run.id));
    expect(after.state).toBe("held_for_human");
    const [task] = await h.db.select().from(tasks).where(eq(tasks.id, run.taskId));
    expect(task.state).toBe("blocked");
    const msgs = await listMessages(h.db, "tA", "oA");
    const last = msgs.at(-1)!;
    expect(last.kind).toBe("system");
    expect(last.body).toContain("declined");
    expect(last.body).toContain("#7");
  });

  it("cross-org decline is denied", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    await expect(declineRun(h.db, { orgId: "oB", runId: run.id })).rejects.toThrow();
  });
});
