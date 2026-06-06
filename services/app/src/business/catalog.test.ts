import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs } from "../db/schema.js";
import { createBusiness, businessPnl, decidePaymentIntent } from "./businesses.js";
import {
  createOffering, listOfferings, createQuote, checkoutQuote,
  assertChargeMatchesQuote, QuoteChargeMismatchError,
} from "./catalog.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

let bid: string;
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  bid = (await createBusiness(h.db, { orgId: "o1", name: "ResumeAI" })).id;
});

describe("offer catalog (#152 2.1)", () => {
  it("creates and lists an offering with a price", async () => {
    await createOffering(h.db, { orgId: "o1", businessId: bid, sku: "resume-pro", name: "Resume Review Pro", priceCents: 3300 });
    const list = await listOfferings(h.db, "o1", bid);
    expect(list.map((o) => [o.sku, o.priceCents])).toEqual([["resume-pro", 3300]]);
  });
  it("rejects a non-positive price", async () => {
    await expect(createOffering(h.db, { orgId: "o1", businessId: bid, sku: "x", name: "X", priceCents: 0 })).rejects.toThrow();
  });
});

describe("quoting derives price from the catalog (#152 2.2)", () => {
  it("a quote copies the offering's price — the caller never supplies an amount", async () => {
    const off = await createOffering(h.db, { orgId: "o1", businessId: bid, sku: "resume-pro", name: "Resume Review Pro", priceCents: 3300 });
    const q = await createQuote(h.db, { orgId: "o1", offeringId: off.id, customer: "alice@x.com" });
    expect(q.quotedCents).toBe(3300); // sourced from the catalog, not hand-entered
    expect(q.state).toBe("open");
  });
});

describe("quote==charge guardrail (#152 6.2)", () => {
  it("assertChargeMatchesQuote throws on any mismatch (the $15-vs-$33 guard)", () => {
    expect(() => assertChargeMatchesQuote(3300, 1500)).toThrow(QuoteChargeMismatchError);
    expect(() => assertChargeMatchesQuote(3300, 3300)).not.toThrow();
  });
});

describe("checkout resolves to the exact quoted amount (#152 3.1)", () => {
  it("creates a pending payment intent for exactly the quoted price", async () => {
    const off = await createOffering(h.db, { orgId: "o1", businessId: bid, sku: "resume-pro", name: "Resume Review Pro", priceCents: 3300 });
    const q = await createQuote(h.db, { orgId: "o1", offeringId: off.id, customer: "alice@x.com" });
    const { paymentIntent, quote } = await checkoutQuote(h.db, { orgId: "o1", quoteId: q.id });
    expect(paymentIntent!.amountCents).toBe(3300);  // charge === quote === catalog price
    expect(paymentIntent!.state).toBe("pending");    // human money gate still applies
    expect(quote.state).toBe("charged");
    // nothing is booked until a human approves the intent
    expect((await businessPnl(h.db, "o1", bid)).revenueCents).toBe(0);
    await decidePaymentIntent(h.db, { orgId: "o1", intentId: paymentIntent!.id, approve: true, byUserId: "m1" });
    expect((await businessPnl(h.db, "o1", bid)).revenueCents).toBe(3300); // booked at the quoted amount
  });
  it("checkout is idempotent — a second call does not double-charge", async () => {
    const off = await createOffering(h.db, { orgId: "o1", businessId: bid, sku: "x", name: "X", priceCents: 1000 });
    const q = await createQuote(h.db, { orgId: "o1", offeringId: off.id });
    const first = await checkoutQuote(h.db, { orgId: "o1", quoteId: q.id });
    const second = await checkoutQuote(h.db, { orgId: "o1", quoteId: q.id });
    expect(second.alreadyCheckedOut).toBe(true);
    expect(first.paymentIntent!.id).toBeTruthy();
  });
});
