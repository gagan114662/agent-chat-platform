import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs } from "../db/schema.js";
import { createBusiness, addLedgerEntry, createPaymentIntent, decidePaymentIntent } from "./businesses.js";
import { listDeliveries, fulfillDelivery } from "./delivery.js";
import { incomeStatement, portfolioPnl } from "./accounting.js";
import { openTicket, listTickets, resolveTicket } from "./support.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

let bid: string;
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  bid = (await createBusiness(h.db, { orgId: "o1", name: "ResumeAI" })).id;
});

describe("delivery (#152 5.1)", () => {
  it("approving a payment auto-opens a pending delivery; fulfilling marks it delivered", async () => {
    const pi = await createPaymentIntent(h.db, { orgId: "o1", businessId: bid, amountCents: 3300, customer: "alice@x.com" });
    expect(await listDeliveries(h.db, "o1", bid)).toHaveLength(0); // none until paid
    await decidePaymentIntent(h.db, { orgId: "o1", intentId: pi.id, approve: true, byUserId: "m1" });
    const pending = await listDeliveries(h.db, "o1", bid);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ state: "pending", customer: "alice@x.com", paymentIntentId: pi.id });
    const done = await fulfillDelivery(h.db, { orgId: "o1", deliveryId: pending[0].id, artifact: "https://resume.example/alice.pdf", kind: "file" });
    expect(done).toMatchObject({ state: "delivered", artifact: "https://resume.example/alice.pdf", kind: "file" });
    expect(done?.deliveredAt).toBeTruthy();
  });
  it("a declined payment opens no delivery", async () => {
    const pi = await createPaymentIntent(h.db, { orgId: "o1", businessId: bid, amountCents: 1000, customer: "bob" });
    await decidePaymentIntent(h.db, { orgId: "o1", intentId: pi.id, approve: false, byUserId: "m1" });
    expect(await listDeliveries(h.db, "o1", bid)).toHaveLength(0);
  });
});

describe("accounting (#152 8.2)", () => {
  it("income statement breaks revenue/cost by source with margin %", async () => {
    await addLedgerEntry(h.db, { orgId: "o1", businessId: bid, kind: "revenue", amountCents: 10000, source: "payment" });
    await addLedgerEntry(h.db, { orgId: "o1", businessId: bid, kind: "cost", amountCents: 2500, source: "agent_spend" });
    await addLedgerEntry(h.db, { orgId: "o1", businessId: bid, kind: "cost", amountCents: 1500, source: "infra" });
    const is = await incomeStatement(h.db, "o1", bid);
    expect(is).toMatchObject({ revenueCents: 10000, costCents: 4000, netCents: 6000, marginPct: 60, profitable: true });
    expect(is.costBySource).toEqual({ agent_spend: 2500, infra: 1500 });
    expect(is.revenueBySource).toEqual({ payment: 10000 });
  });
  it("portfolio rolls up across businesses", async () => {
    const b2 = await createBusiness(h.db, { orgId: "o1", name: "B2" });
    await addLedgerEntry(h.db, { orgId: "o1", businessId: bid, kind: "revenue", amountCents: 5000, source: "payment" });
    await addLedgerEntry(h.db, { orgId: "o1", businessId: b2.id, kind: "cost", amountCents: 1000, source: "infra" });
    const p = await portfolioPnl(h.db, "o1");
    expect(p).toMatchObject({ totalRevenueCents: 5000, totalCostCents: 1000, totalNetCents: 4000, profitableCount: 1 });
    expect(p.businesses).toHaveLength(2);
  });
});

describe("support (#152 7.1)", () => {
  it("opens a ticket, lists open ones, resolves it", async () => {
    const t = await openTicket(h.db, { orgId: "o1", businessId: bid, customer: "alice@x.com", body: "My resume has a typo, can you fix it?" });
    expect(t.state).toBe("open");
    expect(t.subject).toBe("My resume has a typo, can you fix it?");
    expect(await listTickets(h.db, "o1", bid, { state: "open" })).toHaveLength(1);
    const r = await resolveTicket(h.db, { orgId: "o1", ticketId: t.id, resolution: "Fixed and re-delivered", byActor: "a1" });
    expect(r?.state).toBe("resolved");
    expect(await listTickets(h.db, "o1", bid, { state: "open" })).toHaveLength(0);
    expect(await listTickets(h.db, "o1", bid, { state: "resolved" })).toHaveLength(1);
  });
});
