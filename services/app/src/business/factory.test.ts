import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs, offerings, goals } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { addLedgerEntry } from "./businesses.js";
import { discoverOpportunities, spawnBusiness, rebalancePortfolio, spawnTopOpportunity } from "./factory.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
});

describe("opportunity discovery (#154)", () => {
  it("emits ranked, demand-validated specs with a price", () => {
    const specs = discoverOpportunities();
    expect(specs.length).toBeGreaterThan(0);
    expect(specs[0]).toHaveProperty("priceCents");
    expect(specs[0]).toHaveProperty("demandSignal");
    // sorted descending by demand
    for (let i = 1; i < specs.length; i++) expect(specs[i - 1].demandSignal).toBeGreaterThanOrEqual(specs[i].demandSignal);
  });
  it("respects a custom generator/probe and the demand floor", () => {
    const specs = discoverOpportunities({
      generate: () => [
        { title: "Hot", offer: "x", targetCustomer: "job seekers", priceCents: 1000, successMetric: "m" },
        { title: "Cold", offer: "y", targetCustomer: "nobody", priceCents: 99999, successMetric: "m" },
      ],
      minDemand: 0.6,
    });
    expect(specs.map((s) => s.title)).toEqual(["Hot"]); // Cold filtered by the demand floor
  });
});

describe("business spawner (#153)", () => {
  it("stands up a business + catalog offering + autonomy-on goal from a spec", async () => {
    const [spec] = discoverOpportunities({ limit: 1 });
    const { business, offering, goal } = await spawnBusiness(h.db, { orgId: "o1", spec });
    expect(business.name).toBe(spec.title);
    expect(offering.priceCents).toBe(spec.priceCents);
    expect(goal.businessId).toBe(business.id);
    const [g] = await h.db.select().from(goals).where(eq(goals.id, goal.id));
    expect(g.autonomy).toBe(true); // handed to the autonomy engine
  });
  it("spawnTopOpportunity provisions the highest-demand idea", async () => {
    const out = await spawnTopOpportunity(h.db, { orgId: "o1" });
    expect(out?.business.name).toBe("ResumeAI"); // top of the seed ranking
  });
});

describe("portfolio manager (#155)", () => {
  it("kills losers, scales winners, holds the new — and allocates budget to survivors", async () => {
    // winner: profitable with healthy margin
    const win = await spawnBusiness(h.db, { orgId: "o1", spec: { title: "Winner", offer: "o", targetCustomer: "job seekers", priceCents: 3300, successMetric: "m", demandSignal: 0.9 } });
    await addLedgerEntry(h.db, { orgId: "o1", businessId: win.business.id, kind: "revenue", amountCents: 10000, source: "payment" });
    await addLedgerEntry(h.db, { orgId: "o1", businessId: win.business.id, kind: "cost", amountCents: 2000, source: "infra" });
    // loser: revenue but underwater
    const lose = await spawnBusiness(h.db, { orgId: "o1", spec: { title: "Loser", offer: "o", targetCustomer: "job seekers", priceCents: 3300, successMetric: "m", demandSignal: 0.9 } });
    await addLedgerEntry(h.db, { orgId: "o1", businessId: lose.business.id, kind: "revenue", amountCents: 1000, source: "payment" });
    await addLedgerEntry(h.db, { orgId: "o1", businessId: lose.business.id, kind: "cost", amountCents: 5000, source: "infra" });
    // newcomer: no revenue yet
    const fresh = await spawnBusiness(h.db, { orgId: "o1", spec: { title: "Fresh", offer: "o", targetCustomer: "job seekers", priceCents: 3300, successMetric: "m", demandSignal: 0.9 } });

    const report = await rebalancePortfolio(h.db, { orgId: "o1", totalBudgetCents: 10000 });
    const byName = Object.fromEntries(report.decisions.map((d) => [d.name, d]));
    expect(byName["Winner"].action).toBe("scale");
    expect(byName["Loser"].action).toBe("kill");
    expect(byName["Fresh"].action).toBe("hold");

    // kill applied: loser's goal paused + offering retired
    const [lg] = await h.db.select().from(goals).where(eq(goals.id, lose.goal.id));
    expect(lg.autonomy).toBe(false);
    const [lo] = await h.db.select().from(offerings).where(and(eq(offerings.businessId, lose.business.id), eq(offerings.orgId, "o1")));
    expect(lo.active).toBe(false);
    // winner stays on
    const [wg] = await h.db.select().from(goals).where(eq(goals.id, win.goal.id));
    expect(wg.autonomy).toBe(true);
    // budget went only to survivors (winner + fresh), winner-weighted
    expect(byName["Loser"].allocCents).toBe(0);
    expect(byName["Winner"].allocCents).toBeGreaterThan(byName["Fresh"].allocCents);
    expect(report.killed).toBe(1);
    expect(report.scaled).toBe(1);
  });
});
