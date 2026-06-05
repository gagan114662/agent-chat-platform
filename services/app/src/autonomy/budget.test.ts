import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs, workspaces, goals } from "../db/schema.js";
import { createBusiness, addLedgerEntry } from "../business/businesses.js";
import { createGoal, setGoalAutonomy } from "./goals.js";
import { budgetTier, orgSpendCents, enforceBudget } from "./budget.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

describe("budgetTier (#149.2)", () => {
  it("tiers ok → warning(60%) → hard(100%); unset cap is unmetered", () => {
    expect(budgetTier(10, 100).tier).toBe("ok");
    expect(budgetTier(70, 100).tier).toBe("warning");
    expect(budgetTier(100, 100).tier).toBe("hard");
    expect(budgetTier(999, 0).tier).toBe("ok"); // no cap → never enforced
  });
});

describe("enforceBudget (#149.2)", () => {
  let bid: string, gid: string;
  beforeEach(async () => {
    await h.reset();
    await h.db.insert(orgs).values({ id: "o1", name: "O" });
    await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
    bid = (await createBusiness(h.db, { orgId: "o1", name: "B" })).id;
    const g = await createGoal(h.db, { orgId: "o1", title: "G", criteria: "x", byKind: "human", byId: "m1" });
    gid = g.id;
    await h.db.update(goals).set({ state: "active" }).where(eq(goals.id, gid));
    await setGoalAutonomy(h.db, "o1", gid, true);
  });

  it("sums metered cost and pauses autonomy goals at the hard limit", async () => {
    await addLedgerEntry(h.db, { orgId: "o1", businessId: bid, kind: "cost", amountCents: 120, source: "api" });
    await addLedgerEntry(h.db, { orgId: "o1", businessId: bid, kind: "revenue", amountCents: 5000, source: "payment" }); // revenue doesn't count as spend
    expect(await orgSpendCents(h.db, "o1")).toBe(120);
    const status = await enforceBudget(h.db, "o1", 100); // cap 100¢, spent 120¢ → hard
    expect(status.tier).toBe("hard");
    expect(status.pausedGoals).toBe(1);
    // the goal's autonomy was turned OFF (paused, state preserved)
    expect((await h.db.select().from(goals).where(eq(goals.id, gid)))[0].autonomy).toBe(false);
  });

  it("does not pause under the cap", async () => {
    await addLedgerEntry(h.db, { orgId: "o1", businessId: bid, kind: "cost", amountCents: 30, source: "api" });
    const status = await enforceBudget(h.db, "o1", 100);
    expect(status.tier).toBe("ok");
    expect(status.pausedGoals).toBe(0);
    expect((await h.db.select().from(goals).where(eq(goals.id, gid)))[0].autonomy).toBe(true);
  });
});
