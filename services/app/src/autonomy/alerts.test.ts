import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { detectAlerts, recordAlerts } from "./alerts.js";
import { orgs, workspaces, channels, threads, tasks, runs, runEvents, incidents, messages } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// Seed two orgs with a task each so runs have a valid taskId. Org-A is the org
// under test; org-B exists only to prove org-scoping (its runs must be excluded).
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "o1", name: "O" }, { id: "o2", name: "O B" }]);
  await h.db.insert(workspaces).values([{ id: "w1", orgId: "o1", name: "W" }, { id: "w2", orgId: "o2", name: "W B" }]);
  await h.db.insert(channels).values([{ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" }, { id: "c2", orgId: "o2", workspaceId: "w2", name: "general" }]);
  await h.db.insert(threads).values([
    { id: "t1", orgId: "o1", channelId: "c1", title: "T1" },
    { id: "tb", orgId: "o2", channelId: "c2", title: "TB" },
  ]);
  await h.db.insert(tasks).values([
    { id: "k1", orgId: "o1", threadId: "t1", title: "do k1", state: "in_progress", createdByKind: "agent", createdById: "planner" },
    { id: "kb", orgId: "o2", threadId: "tb", title: "do kb", state: "in_progress", createdByKind: "agent", createdById: "planner" },
  ]);
});

describe("detectAlerts", () => {
  it("emits a high-severity alert for each failed run (checks_failed/error/timeout)", async () => {
    await h.db.insert(runs).values([
      { id: "r-cf", orgId: "o1", taskId: "k1", state: "checks_failed", workflowId: "wf1", prNumber: 7 },
      { id: "r-err", orgId: "o1", taskId: "k1", state: "error", workflowId: "wf2" },
      { id: "r-to", orgId: "o1", taskId: "k1", state: "timeout", workflowId: "wf3" },
      { id: "r-ok", orgId: "o1", taskId: "k1", state: "merged", workflowId: "wf4" },
    ]);
    const alerts = await detectAlerts(h.db, "o1");
    const failed = alerts.filter((a) => a.key.startsWith("run-failed:"));
    expect(failed.map((a) => a.runId).sort()).toEqual(["r-cf", "r-err", "r-to"]);
    for (const a of failed) {
      expect(a.severity).toBe("high");
      expect(a.title).toMatch(/Run r-/);
    }
    // the merged run produces no alert
    expect(alerts.find((a) => a.runId === "r-ok")).toBeUndefined();
  });

  it("emits a CI-stuck alert when a run has >= the threshold of ci_fix_attempt events", async () => {
    process.env.ALERT_CI_FIX_THRESHOLD = "2";
    await h.db.insert(runs).values({ id: "r-stuck", orgId: "o1", taskId: "k1", state: "running", workflowId: "wfs" });
    await h.db.insert(runEvents).values([
      { id: "r-stuck:ci_fix_attempt:1", orgId: "o1", runId: "r-stuck", seq: 0, type: "ci_fix_attempt", payload: {} },
      { id: "r-stuck:ci_fix_attempt:2", orgId: "o1", runId: "r-stuck", seq: 1, type: "ci_fix_attempt", payload: {} },
    ]);
    const alerts = await detectAlerts(h.db, "o1");
    const stuck = alerts.find((a) => a.key === "ci-stuck:r-stuck");
    expect(stuck).toBeDefined();
    expect(stuck!.severity).toBe("high");
    expect(stuck!.runId).toBe("r-stuck");
    delete process.env.ALERT_CI_FIX_THRESHOLD;
  });

  it("emits a medium aging-held alert for a held_for_human run older than the threshold", async () => {
    process.env.ALERT_HELD_AGING_MINUTES = "60";
    await h.db.insert(runs).values([
      { id: "r-held-old", orgId: "o1", taskId: "k1", state: "held_for_human", workflowId: "wfh1", prNumber: 9 },
      { id: "r-held-new", orgId: "o1", taskId: "k1", state: "held_for_human", workflowId: "wfh2" },
    ]);
    // last activity ~2h ago for the old one (aging), ~1min ago for the new one.
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const fresh = new Date(Date.now() - 60 * 1000);
    await h.db.insert(runEvents).values([
      { id: "r-held-old:outcome", orgId: "o1", runId: "r-held-old", seq: 0, type: "outcome", payload: {}, createdAt: old },
      { id: "r-held-new:outcome", orgId: "o1", runId: "r-held-new", seq: 0, type: "outcome", payload: {}, createdAt: fresh },
    ]);
    const alerts = await detectAlerts(h.db, "o1");
    const aging = alerts.filter((a) => a.key.startsWith("held-aging:"));
    expect(aging.map((a) => a.runId)).toEqual(["r-held-old"]);
    expect(aging[0].severity).toBe("medium");
    delete process.env.ALERT_HELD_AGING_MINUTES;
  });

  it("is org-scoped — another org's failed runs are excluded", async () => {
    await h.db.insert(runs).values([
      { id: "r-a", orgId: "o1", taskId: "k1", state: "checks_failed", workflowId: "wfa" },
      { id: "r-b", orgId: "o2", taskId: "kb", state: "checks_failed", workflowId: "wfb" },
    ]);
    const alerts = await detectAlerts(h.db, "o1");
    expect(alerts.map((a) => a.runId)).toEqual(["r-a"]);
  });
});

describe("recordAlerts", () => {
  it("records each alert as an idempotent alert-incident (2nd call → 0 new) and posts when a thread is configured", async () => {
    await h.db.insert(runs).values({ id: "r-cf", orgId: "o1", taskId: "k1", state: "checks_failed", workflowId: "wf1" });
    const alerts = await detectAlerts(h.db, "o1");
    expect(alerts.length).toBe(1);

    const first = await recordAlerts(h.db, h.sql, { orgId: "o1", threadId: "t1" }, alerts);
    expect(first).toBe(1);

    const rows = await h.db.select().from(incidents).where(eq(incidents.orgId, "o1"));
    expect(rows.length).toBe(1);
    expect(rows[0].source).toBe("alert");
    expect(rows[0].id).toBe("o1:run-failed:r-cf");

    // a system message was posted to the configured thread
    const msgs = await h.db.select().from(messages).where(eq(messages.threadId, "t1"));
    expect(msgs.length).toBe(1);
    expect(msgs[0].kind).toBe("system");

    // idempotent: re-recording the same alerts inserts nothing new
    const second = await recordAlerts(h.db, h.sql, { orgId: "o1", threadId: "t1" }, alerts);
    expect(second).toBe(0);
    const after = await h.db.select().from(incidents).where(eq(incidents.orgId, "o1"));
    expect(after.length).toBe(1);
  });

  it("records incidents without a thread configured (no posting)", async () => {
    await h.db.insert(runs).values({ id: "r-cf", orgId: "o1", taskId: "k1", state: "checks_failed", workflowId: "wf1" });
    const alerts = await detectAlerts(h.db, "o1");
    const n = await recordAlerts(h.db, h.sql, { orgId: "o1" }, alerts);
    expect(n).toBe(1);
    const msgs = await h.db.select().from(messages).where(eq(messages.threadId, "t1"));
    expect(msgs.length).toBe(0);
  });
});
