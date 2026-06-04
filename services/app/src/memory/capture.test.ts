import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { captureDecision } from "./capture.js";
import { listNodes } from "./memory.js";
import { orgs } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); await h.db.insert(orgs).values({ id: "o1", name: "O" }); });

describe("captureDecision", () => {
  it("records a decision memory node for a terminal run", async () => {
    await captureDecision(h.db, { orgId: "o1", runId: "r1", agentId: "a1", threadId: "t1", intent: "fix login", outcome: "merged", prNumber: 7 });
    const nodes = await listNodes(h.db, "o1", { kind: "decision" });
    expect(nodes.length).toBe(1);
    expect(nodes[0].label).toContain("merged");
    expect((nodes[0].metadata as any)).toMatchObject({ runId: "r1", agentId: "a1", outcome: "merged", prNumber: 7 });
  });
  it("never throws (best-effort)", async () => {
    await expect(captureDecision(h.db, { orgId: "o1", runId: "r2", agentId: "a", threadId: "t", intent: "x", outcome: "timeout" })).resolves.toBeUndefined();
  });
});
