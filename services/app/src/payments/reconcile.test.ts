import { describe, it, expect } from "vitest";
import { reconcile } from "./reconcile.js";

describe("payment reconciliation (#115)", () => {
  it("flags money moved without an approval", () => {
    const decisions = [{ id: "d1", recipient: "acct_a", amountCents: 2000, decision: "approve" }];
    const executed = [
      { id: "t1", recipient: "acct_a", amountCents: 2000 }, // covered
      { id: "t2", recipient: "acct_rogue", amountCents: 9000 }, // NOT approved
    ];
    const r = reconcile(decisions, executed);
    expect(r.executedWithoutApproval.map((e) => e.id)).toEqual(["t2"]);
    expect(r.approvedNotExecuted).toEqual([]);
    expect(r.totalExecutedCents).toBe(11000);
  });

  it("flags approvals that never executed", () => {
    const decisions = [
      { id: "d1", recipient: "acct_a", amountCents: 2000, decision: "approve" },
      { id: "d2", recipient: "acct_b", amountCents: 500, decision: "approve" },
      { id: "d3", recipient: "acct_c", amountCents: 99, decision: "decline" },
    ];
    const executed = [{ id: "t1", recipient: "acct_a", amountCents: 2000 }];
    const r = reconcile(decisions, executed);
    expect(r.approvedNotExecuted.map((d) => d.id)).toEqual(["d2"]);
    expect(r.executedWithoutApproval).toEqual([]);
    expect(r.totalApprovedCents).toBe(2500);
  });
});
