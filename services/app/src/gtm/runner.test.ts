import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs } from "../db/schema.js";
import { createBusiness, businessPnl, addLead } from "../business/businesses.js";
import { createOffering } from "../business/catalog.js";
import { GTM_PLAYBOOKS, playbooksFor } from "./playbooks.js";
import { runGtmMotion, listGtmActions, noopGtmConnector, type GtmConnector } from "./runner.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

let bid: string;
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  bid = (await createBusiness(h.db, { orgId: "o1", name: "ResumeAI" })).id;
  await createOffering(h.db, { orgId: "o1", businessId: bid, sku: "resume-pro", name: "Resume Review Pro", priceCents: 3300 });
});

describe("GTM playbook catalog (#41)", () => {
  it("is function-organized and non-empty", () => {
    expect(GTM_PLAYBOOKS.length).toBeGreaterThan(0);
    expect(playbooksFor("marketing").every((p) => p.fn === "marketing")).toBe(true);
    expect(GTM_PLAYBOOKS.every((p) => p.source.startsWith("skills/"))).toBe(true);
  });
});

describe("autonomous GTM motion — no human gate (#41)", () => {
  it("executes every applicable playbook with no approval step, recording each action + the audit trail", async () => {
    const res = await runGtmMotion(h.db, { orgId: "o1", businessId: bid });
    expect(res.ran).toBe(GTM_PLAYBOOKS.length); // ran them all, no approval gate
    const recorded = await listGtmActions(h.db, "o1", bid);
    expect(recorded.length).toBe(res.ran);     // every action is traceable
  });

  it("the default no-op connector records intent but sends nothing (capability gate, not approval gate)", async () => {
    const res = await runGtmMotion(h.db, { orgId: "o1", businessId: bid });
    expect(res.sent).toBe(0); // nothing physically sent without operator creds
    expect((await listGtmActions(h.db, "o1", bid)).every((a) => a.sent === false)).toBe(true);
  });

  it("a real (wired) connector actually sends, and reach reflects the audience", async () => {
    await addLead(h.db, { orgId: "o1", businessId: bid, identifier: "v1", stage: "visitor" });
    await addLead(h.db, { orgId: "o1", businessId: bid, identifier: "v2", stage: "visitor" });
    const live: GtmConnector = async (a) => ({ sent: true, reach: a.audienceSize });
    const res = await runGtmMotion(h.db, { orgId: "o1", businessId: bid, connector: live });
    expect(res.sent).toBe(res.ran);
    const outreach = (await listGtmActions(h.db, "o1", bid)).find((a) => a.actionKind === "outreach");
    expect(outreach?.reach).toBe(2); // audience = the 2 visitor leads
  });

  it("books GTM spend so the motion shows up in P&L (feeds the portfolio manager)", async () => {
    await runGtmMotion(h.db, { orgId: "o1", businessId: bid, costPerActionCents: 10 });
    const pnl = await businessPnl(h.db, "o1", bid);
    const spendActions = GTM_PLAYBOOKS.filter((p) => p.actionKind === "outreach" || p.actionKind === "sequence").length;
    expect(pnl.costCents).toBe(spendActions * 10);
  });

  it("can scope to a single GTM function", async () => {
    const res = await runGtmMotion(h.db, { orgId: "o1", businessId: bid, fn: "marketing" });
    expect(res.ran).toBe(playbooksFor("marketing").length);
    expect(res.actions.every((a) => a.fn === "marketing")).toBe(true);
  });

  it("throws for an unknown business", async () => {
    await expect(runGtmMotion(h.db, { orgId: "o1", businessId: "nope" })).rejects.toThrow(/business not found/);
  });

  it("noopGtmConnector reports intended reach without sending", async () => {
    expect(await noopGtmConnector({ fn: "marketing", skill: "x", actionKind: "outreach", summary: "", payload: {}, audienceSize: 5 })).toEqual({ sent: false, reach: 5 });
  });
});
