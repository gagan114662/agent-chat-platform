import { describe, it, expect, vi, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { reportRunUsage } from "./report.js";
import { orgs } from "../db/schema.js";
import type { BillingReporter } from "./billing.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); });

describe("reportRunUsage", () => {
  it("resolves the org's stripe customer and reports usage", async () => {
    await h.db.insert(orgs).values({ id: "o1", name: "O", stripeCustomerId: "cus_42" });
    const reporter: BillingReporter = { reportRun: vi.fn(async () => {}) };
    await reportRunUsage(h.db, reporter, { orgId: "o1", runId: "r1", outcome: "merged" });
    expect(reporter.reportRun).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "o1", runId: "r1", stripeCustomerId: "cus_42",
      usage: { eventName: "agent_run", quantity: 1 },
    }));
  });

  it("never throws even if the reporter fails (best-effort billing)", async () => {
    await h.db.insert(orgs).values({ id: "o1", name: "O" });
    const reporter: BillingReporter = { reportRun: vi.fn(async () => { throw new Error("stripe down"); }) };
    await expect(reportRunUsage(h.db, reporter, { orgId: "o1", runId: "r1", outcome: "merged" })).resolves.toBeUndefined();
  });
});
