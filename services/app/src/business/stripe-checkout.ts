import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { quotes, offerings } from "../db/schema.js";
import type { StripeClient } from "../billing/billing.js";
import { assertChargeMatchesQuote } from "./catalog.js";
import { addLedgerEntry, addLead } from "./businesses.js";
import { createDelivery, fulfillDelivery } from "./delivery.js";
import { record } from "../audit/audit-log.js";

// Actual-revenue path: turn a quote into a REAL Stripe Checkout Session for the exact
// quoted amount, and book revenue + auto-deliver only on a VERIFIED payment webhook.
// The customer paying is the real event — booking revenue on a settled Stripe payment
// is real money received, not an agent draft, so this is the one place revenue is
// recognized autonomously. Nothing activates until the operator sets STRIPE_API_KEY +
// STRIPE_WEBHOOK_SECRET (their account); with no key the routes answer "not configured".

// Open a Stripe Checkout Session for an OPEN quote. Returns the hosted checkout URL —
// the real, correctly-priced Buy target. quoted === charged is asserted before the call.
export async function startQuoteStripeCheckout(db: DB, args: {
  orgId: string; quoteId: string; stripe: StripeClient; baseUrl: string; customerEmail?: string;
}) {
  const [q] = await db.select().from(quotes).where(and(eq(quotes.id, args.quoteId), eq(quotes.orgId, args.orgId)));
  if (!q) throw new Error("quote not found");
  if (q.state === "paid") return { quote: q, url: null, alreadyPaid: true };
  const [off] = await db.select().from(offerings).where(and(eq(offerings.id, q.offeringId), eq(offerings.orgId, args.orgId)));
  assertChargeMatchesQuote(q.quotedCents, q.quotedCents); // the charge IS the quote
  const session = await args.stripe.createPaymentSession({
    amountCents: q.quotedCents,
    productName: off?.name ?? "Purchase",
    clientReferenceId: q.id,
    customerEmail: args.customerEmail ?? (q.customer || undefined),
    successUrl: `${args.baseUrl}/public/thanks/${q.id}`,
    cancelUrl: `${args.baseUrl}/public/offer/${q.offeringId}?checkout=cancel`,
  });
  await db.update(quotes).set({ stripeSessionId: session.id }).where(and(eq(quotes.id, q.id), eq(quotes.orgId, args.orgId)));
  await record(db, { orgId: args.orgId, actorKind: "system", actorId: "stripe", action: "quote.checkout_session", resource: q.businessId, payload: { quoteId: q.id, sessionId: session.id, amountCents: q.quotedCents } });
  return { quote: q, url: session.url, alreadyPaid: false };
}

// Fulfill a paid quote (called by the Stripe webhook on checkout.session.completed).
// Idempotent. Books revenue at the EXACT amount Stripe settled (asserted == quote),
// marks the payer a customer, and auto-opens + fulfills delivery. orgId is resolved
// from the quote (the webhook is unauthenticated; the quote id is the reference).
export async function fulfillPaidQuote(db: DB, args: { quoteId: string; amountTotalCents?: number }) {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, args.quoteId));
  if (!q) return { ok: false, reason: "quote not found" };
  if (q.state === "paid") return { ok: true, alreadyPaid: true, quote: q };
  // guardrail: Stripe must have charged exactly what we quoted.
  if (args.amountTotalCents != null) assertChargeMatchesQuote(q.quotedCents, args.amountTotalCents);
  await db.update(quotes).set({ state: "paid" }).where(eq(quotes.id, q.id));
  await addLedgerEntry(db, { orgId: q.orgId, businessId: q.businessId, kind: "revenue", amountCents: q.quotedCents, source: "stripe", memo: `paid quote ${q.id} ${q.customer}`.trim() });
  if (q.customer) await addLead(db, { orgId: q.orgId, businessId: q.businessId, identifier: q.customer, stage: "customer", source: "stripe" });
  const delivery = await createDelivery(db, { orgId: q.orgId, businessId: q.businessId, customer: q.customer, paymentIntentId: q.stripeSessionId ?? q.id });
  const fulfilled = await fulfillDelivery(db, { orgId: q.orgId, deliveryId: delivery.id });
  await record(db, { orgId: q.orgId, actorKind: "system", actorId: "stripe", action: "quote.paid", resource: q.businessId, payload: { quoteId: q.id, amountCents: q.quotedCents, deliveryId: delivery.id } });
  return { ok: true, quote: { ...q, state: "paid" }, deliveryId: delivery.id, delivered: fulfilled?.state === "delivered" };
}
