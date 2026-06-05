import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs } from "../db/schema.js";
import {
  createBusiness, listBusinesses, businessPnl, addLedgerEntry,
  createPaymentIntent, decidePaymentIntent,
  addLead, funnel, createCampaign, decideCampaign,
} from "./businesses.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

let bid: string;
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  bid = (await createBusiness(h.db, { orgId: "o1", name: "ResumeAI" })).id;
});

describe("business entity + P&L (#141)", () => {
  it("creates and lists businesses", async () => {
    expect((await listBusinesses(h.db, "o1")).map((b) => b.name)).toEqual(["ResumeAI"]);
  });
  it("computes net P&L = revenue - cost", async () => {
    await addLedgerEntry(h.db, { orgId: "o1", businessId: bid, kind: "cost", amountCents: 500, source: "agent_spend" });
    await addLedgerEntry(h.db, { orgId: "o1", businessId: bid, kind: "revenue", amountCents: 2000, source: "manual" });
    const p = await businessPnl(h.db, "o1", bid);
    expect(p).toMatchObject({ revenueCents: 2000, costCents: 500, netCents: 1500, profitable: true });
  });
});

describe("human-gated revenue rails (#141)", () => {
  it("a payment intent is pending until a human approves; approval books revenue + a customer lead", async () => {
    const pi = await createPaymentIntent(h.db, { orgId: "o1", businessId: bid, amountCents: 4900, customer: "alice@x.com" });
    expect(pi.state).toBe("pending");
    expect((await businessPnl(h.db, "o1", bid)).revenueCents).toBe(0); // nothing booked yet
    const approved = await decidePaymentIntent(h.db, { orgId: "o1", intentId: pi.id, approve: true, byUserId: "m1" });
    expect(approved?.state).toBe("approved");
    expect((await businessPnl(h.db, "o1", bid)).revenueCents).toBe(4900); // now booked
    expect((await funnel(h.db, "o1", bid)).customer).toBe(1); // payer became a customer
  });
  it("a declined intent books nothing", async () => {
    const pi = await createPaymentIntent(h.db, { orgId: "o1", businessId: bid, amountCents: 1000, customer: "bob" });
    await decidePaymentIntent(h.db, { orgId: "o1", intentId: pi.id, approve: false, byUserId: "m1" });
    expect((await businessPnl(h.db, "o1", bid)).revenueCents).toBe(0);
  });
});

describe("CRM funnel + gated acquisition (#142)", () => {
  it("tracks a visitor→signup→customer funnel", async () => {
    await addLead(h.db, { orgId: "o1", businessId: bid, identifier: "v1", stage: "visitor" });
    await addLead(h.db, { orgId: "o1", businessId: bid, identifier: "s1", stage: "signup" });
    expect(await funnel(h.db, "o1", bid)).toMatchObject({ visitor: 1, signup: 1, customer: 0 });
  });
  it("a campaign is pending until approved; approval delivers (connector) + seeds visitor leads + books cost", async () => {
    const c = await createCampaign(h.db, { orgId: "o1", businessId: bid, channel: "email", audience: "a@x.com, b@x.com", body: "hi" });
    expect(c.state).toBe("pending");
    const sent = await decideCampaign(h.db, { orgId: "o1", campaignId: c.id, approve: true, byUserId: "m1", costCents: 300 });
    expect(sent?.state).toBe("sent");
    expect(sent?.sentCount).toBe(2);
    expect((await funnel(h.db, "o1", bid)).visitor).toBe(2); // audience became visitors
    expect((await businessPnl(h.db, "o1", bid)).costCents).toBe(300); // ad/api cost booked
  });
});
