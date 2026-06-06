import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs } from "../db/schema.js";
import { createBusiness, businessPnl, funnel } from "./businesses.js";
import { createOffering, createQuote } from "./catalog.js";
import { listDeliveries } from "./delivery.js";
import { startQuoteStripeCheckout, fulfillPaidQuote } from "./stripe-checkout.js";
import type { StripeClient } from "../billing/billing.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

let bid: string, offId: string;
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  bid = (await createBusiness(h.db, { orgId: "o1", name: "ResumeAI" })).id;
  offId = (await createOffering(h.db, { orgId: "o1", businessId: bid, sku: "resume-pro", name: "Resume Review Pro", priceCents: 3300 })).id;
});

const fakeStripe = (capture: { amountCents?: number }): StripeClient => ({
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  createPaymentSession: vi.fn(async (a) => { capture.amountCents = a.amountCents; return { id: "cs_test_123", url: "https://checkout.stripe.test/cs_test_123" }; }),
}) as unknown as StripeClient;

describe("Stripe checkout for a quote (actual revenue)", () => {
  it("opens a session for the EXACT quoted amount and returns the hosted URL", async () => {
    const q = await createQuote(h.db, { orgId: "o1", offeringId: offId, customer: "alice@x.com" });
    const cap: { amountCents?: number } = {};
    const res = await startQuoteStripeCheckout(h.db, { orgId: "o1", quoteId: q.id, stripe: fakeStripe(cap), baseUrl: "https://x.test" });
    expect(cap.amountCents).toBe(3300);              // charged === quoted === catalog
    expect(res.url).toContain("checkout.stripe.test");
  });

  it("a verified payment books revenue at the quoted amount, makes the payer a customer, and auto-delivers", async () => {
    const q = await createQuote(h.db, { orgId: "o1", offeringId: offId, customer: "alice@x.com" });
    await startQuoteStripeCheckout(h.db, { orgId: "o1", quoteId: q.id, stripe: fakeStripe({}), baseUrl: "https://x.test" });
    expect((await businessPnl(h.db, "o1", bid)).revenueCents).toBe(0); // not paid yet
    const r = await fulfillPaidQuote(h.db, { quoteId: q.id, amountTotalCents: 3300 });
    expect(r.ok).toBe(true);
    expect((await businessPnl(h.db, "o1", bid)).revenueCents).toBe(3300); // real revenue booked
    expect((await funnel(h.db, "o1", bid)).customer).toBe(1);            // payer is a customer
    const deliveries = await listDeliveries(h.db, "o1", bid);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].state).toBe("delivered");                       // auto-delivered
  });

  it("is idempotent — a duplicate webhook does not double-book", async () => {
    const q = await createQuote(h.db, { orgId: "o1", offeringId: offId, customer: "bob@x.com" });
    await fulfillPaidQuote(h.db, { quoteId: q.id, amountTotalCents: 3300 });
    const second = await fulfillPaidQuote(h.db, { quoteId: q.id, amountTotalCents: 3300 });
    expect(second.alreadyPaid).toBe(true);
    expect((await businessPnl(h.db, "o1", bid)).revenueCents).toBe(3300); // booked once
  });

  it("refuses to book if Stripe settled a different amount than quoted (guardrail)", async () => {
    const q = await createQuote(h.db, { orgId: "o1", offeringId: offId, customer: "eve@x.com" });
    await expect(fulfillPaidQuote(h.db, { quoteId: q.id, amountTotalCents: 1500 })).rejects.toThrow();
    expect((await businessPnl(h.db, "o1", bid)).revenueCents).toBe(0);
  });
});
