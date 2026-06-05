import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { recordRevenue, recordDebit } from "./treasury.js";
import { profitAndLoss, topBySource, suggestProfitGoal } from "./pnl.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); });

describe("profitability engine (#119)", () => {
  it("computes revenue/cost/profit/margin + per-source attribution", async () => {
    await recordRevenue(h.db, { orgId: "o1", amountCents: 10000, source: "checkout" });
    await recordRevenue(h.db, { orgId: "o1", amountCents: 5000, source: "subscription" });
    await recordDebit(h.db, { orgId: "o1", amountCents: 3000, source: "agent_payout" });
    const p = await profitAndLoss(h.db, "o1");
    expect(p.revenueCents).toBe(15000);
    expect(p.costCents).toBe(3000);
    expect(p.profitCents).toBe(12000);
    expect(p.marginPct).toBe(80);
    expect(p.revenueBySource).toEqual({ checkout: 10000, subscription: 5000 });
    expect(p.costBySource).toEqual({ agent_payout: 3000 });
  });

  it("topBySource picks the largest", () => {
    expect(topBySource({ a: 100, b: 500, c: 50 })).toEqual({ source: "b", cents: 500 });
    expect(topBySource({})).toBeNull();
  });

  it("suggests cutting the biggest cost when unprofitable", async () => {
    await recordRevenue(h.db, { orgId: "o1", amountCents: 1000, source: "checkout" });
    await recordDebit(h.db, { orgId: "o1", amountCents: 4000, source: "agent_payout" });
    const goal = suggestProfitGoal(await profitAndLoss(h.db, "o1"));
    expect(goal).toMatch(/Cut the biggest cost.*agent_payout/);
  });

  it("suggests growing top revenue when profitable", async () => {
    await recordRevenue(h.db, { orgId: "o1", amountCents: 10000, source: "checkout" });
    const goal = suggestProfitGoal(await profitAndLoss(h.db, "o1"));
    expect(goal).toMatch(/Grow the top revenue line.*checkout/);
  });
});
