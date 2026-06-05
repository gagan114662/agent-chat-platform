import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { recordOutcome, getReputation, listReputations } from "./reputation-store.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); });

describe("reputation store (#128) — live track record", () => {
  it("starts neutral, accrues from outcomes (org-scoped)", async () => {
    let r = await getReputation(h.db, "o1", "coder");
    expect(r.runs).toBe(0);
    expect(r.scorePct).toBe(50); // Laplace prior

    await recordOutcome(h.db, "o1", "coder", "success");
    await recordOutcome(h.db, "o1", "coder", "success");
    await recordOutcome(h.db, "o1", "coder", "fail");
    r = await getReputation(h.db, "o1", "coder");
    expect(r.runs).toBe(3);
    expect(r.success).toBe(2);
    expect(r.fail).toBe(1);
    expect(r.scorePct).toBe(60); // (2+1)/(3+2) = 0.6

    // Other org is isolated.
    expect((await getReputation(h.db, "o2", "coder")).runs).toBe(0);
  });

  it("listReputations maps agentId → score for the org", async () => {
    await recordOutcome(h.db, "o1", "a1", "success");
    await recordOutcome(h.db, "o1", "a2", "fail");
    const reps = await listReputations(h.db, "o1");
    expect(reps.a1.runs).toBe(1);
    expect(reps.a2.runs).toBe(1);
    expect(reps.a1.scorePct).toBeGreaterThan(reps.a2.scorePct);
  });
});
