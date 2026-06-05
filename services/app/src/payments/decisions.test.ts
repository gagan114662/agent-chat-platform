import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { recordDecision, listDecisions, suggestAutoApproveThreshold } from "./decisions.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); });

describe("payment decisions (#114) + threshold suggestion", () => {
  it("records and lists decisions newest-first", async () => {
    await recordDecision(h.db, { orgId: "o1", tool: "payments.transfer", amountCents: 2000, recipient: "acct_a", decision: "approve" });
    await recordDecision(h.db, { orgId: "o1", tool: "payments.transfer", amountCents: 9000, recipient: "acct_b", decision: "decline", reason: "too large" });
    await recordDecision(h.db, { orgId: "o2", tool: "payments.transfer", amountCents: 1, decision: "approve" }); // other org

    const rows = await listDecisions(h.db, "o1");
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.orgId === "o1")).toBe(true);
  });

  it("suggests a threshold below the smallest decline, capped by the max approval", async () => {
    await recordDecision(h.db, { orgId: "o1", tool: "t", amountCents: 2000, decision: "approve" });
    await recordDecision(h.db, { orgId: "o1", tool: "t", amountCents: 3500, decision: "approve" });
    await recordDecision(h.db, { orgId: "o1", tool: "t", amountCents: 5000, decision: "decline" });
    const s = await suggestAutoApproveThreshold(h.db, "o1");
    expect(s.approvals).toBe(2);
    expect(s.declines).toBe(1);
    expect(s.maxApprovedCents).toBe(3500);
    expect(s.minDeclinedCents).toBe(5000);
    // min(maxApproved 3500, minDeclined-1 4999) = 3500
    expect(s.suggestedCents).toBe(3500);
  });

  it("with no history suggests 0 (everything still needs a human)", async () => {
    const s = await suggestAutoApproveThreshold(h.db, "o1");
    expect(s.suggestedCents).toBe(0);
  });
});
