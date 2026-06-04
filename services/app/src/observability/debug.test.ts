import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { answerDebug } from "./debug.js";
import { orgs, runs, runEvents, incidents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

async function seed() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  // org A: 1 merged, 2 checks_failed
  await h.db.insert(runs).values([
    { id: "rMerged", orgId: "oA", taskId: "t1", state: "merged", workflowId: "w", prNumber: 1 },
    { id: "rFail1", orgId: "oA", taskId: "t1", state: "checks_failed", workflowId: "w", prNumber: 2 },
    { id: "rFail2", orgId: "oA", taskId: "t1", state: "checks_failed", workflowId: "w", prNumber: 3 },
    // org B run must never leak into org A answers
    { id: "rOther", orgId: "oB", taskId: "t9", state: "checks_failed", workflowId: "w" },
  ]);
  await h.db.insert(runEvents).values([
    { id: "e1", orgId: "oA", runId: "rFail1", seq: 0, type: "run_started", payload: {} },
    { id: "e2", orgId: "oA", runId: "rFail1", seq: 1, type: "ci_failed", payload: {} },
  ]);
  await h.db.insert(incidents).values([
    { id: "oA:i1", orgId: "oA", source: "alert", severity: "high", title: "CI red streak" },
    { id: "oB:i9", orgId: "oB", source: "alert", severity: "low", title: "other org" },
  ]);
}

describe("answerDebug", () => {
  beforeEach(seed);

  it("recent failures lists the org's failing runs only", async () => {
    const a = await answerDebug(h.db, "oA", "what's failing recently?");
    expect(a.kind).toBe("recent-failures");
    const ids = (a.data as { id: string }[]).map((r) => r.id).sort();
    expect(ids).toEqual(["rFail1", "rFail2"]);
    expect(a.answer).not.toContain("rOther");
  });

  it("run counts by state are org-scoped", async () => {
    const a = await answerDebug(h.db, "oA", "how many runs merged vs failed?");
    expect(a.kind).toBe("counts");
    const d = a.data as { counts: Record<string, number>; total: number; failed: number };
    expect(d.counts).toMatchObject({ merged: 1, checks_failed: 2 });
    expect(d.total).toBe(3);
    expect(d.failed).toBe(2);
  });

  it("run <id> summarizes that run's state and recent events", async () => {
    const a = await answerDebug(h.db, "oA", "why did run rFail1 break?");
    expect(a.kind).toBe("run-status");
    expect(a.answer).toContain("rFail1");
    expect(a.answer).toContain("checks_failed");
    expect(a.answer).toContain("ci_failed");
  });

  it("a cross-org run id returns not-found (org-scoped)", async () => {
    const a = await answerDebug(h.db, "oA", "status of run rOther");
    expect(a.kind).toBe("run-status");
    expect(a.data).toBeNull();
    expect(a.answer).toContain("No run rOther");
  });

  it("incidents are org-scoped", async () => {
    const a = await answerDebug(h.db, "oA", "any incidents or alerts?");
    expect(a.kind).toBe("incidents");
    const titles = (a.data as { title: string }[]).map((i) => i.title);
    expect(titles).toEqual(["CI red streak"]);
  });

  it("unknown question returns the help fallback", async () => {
    const a = await answerDebug(h.db, "oA", "what's the weather");
    expect(a.kind).toBe("unknown");
    expect(a.data).toBeNull();
    expect(a.answer).toContain("I can answer");
  });
});
