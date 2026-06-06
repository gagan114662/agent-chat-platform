import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { quotes, offerings } from "../db/schema.js";
import { defaultStripe, type MakeStripe } from "../billing/billing.js";
import { createQuote } from "../business/catalog.js";
import { startQuoteStripeCheckout, fulfillPaidQuote } from "../business/stripe-checkout.js";
import { verifyStripeSignature } from "../integrations/stripe-webhook.js";

// Actual-revenue surface. PUBLIC (no session): a customer opens a Stripe Checkout
// Session for a quote (the quote id is the capability), and Stripe calls our webhook
// on a settled payment → we book revenue + auto-deliver. Both no-op gracefully when
// Stripe isn't configured (operator provides STRIPE_API_KEY + STRIPE_WEBHOOK_SECRET).
export function registerStripeRoutes(app: FastifyInstance, d: { db: DB; makeStripe?: MakeStripe }) {
  const makeStripe = d.makeStripe ?? defaultStripe;
  const baseUrl = process.env.PUBLIC_BASE_URL ?? "https://acp-convene.fly.dev";

  // Customer-facing one-shot: an anonymous visitor buys an offering. Creates a quote
  // from the catalog (price sourced from the offering — quoted === charged) and opens
  // a Stripe Checkout Session in one call. This is what the live offer page's Buy
  // button hits. orgId is resolved from the offering (the offering id is the capability).
  app.post("/public/buy/:offeringId", async (req, reply) => {
    const { offeringId } = req.params as { offeringId: string };
    const { email } = (req.body ?? {}) as { email?: string };
    const [off] = await d.db.select().from(offerings).where(eq(offerings.id, offeringId));
    if (!off) return reply.code(404).send({ error: "offering not found" });
    if (!off.active) return reply.code(409).send({ error: "offering is not available" });
    let stripe;
    try { stripe = makeStripe(); }
    catch { return reply.code(400).send({ error: "payments not configured yet — operator must set STRIPE_API_KEY" }); }
    try {
      const q = await createQuote(d.db, { orgId: off.orgId, offeringId, customer: email });
      const res = await startQuoteStripeCheckout(d.db, { orgId: off.orgId, quoteId: q.id, stripe, baseUrl, customerEmail: email });
      return reply.code(201).send({ quoteId: q.id, amountCents: q.quotedCents, url: res.url });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // Customer-facing: create (or report) the checkout URL for an existing quote.
  app.post("/public/checkout/:quoteId", async (req, reply) => {
    const { quoteId } = req.params as { quoteId: string };
    const { email } = (req.body ?? {}) as { email?: string };
    const [q] = await d.db.select().from(quotes).where(eq(quotes.id, quoteId));
    if (!q) return reply.code(404).send({ error: "quote not found" });
    let stripe;
    try { stripe = makeStripe(); }
    catch { return reply.code(400).send({ error: "payments not configured yet — operator must set STRIPE_API_KEY" }); }
    try {
      const res = await startQuoteStripeCheckout(d.db, { orgId: q.orgId, quoteId, stripe, baseUrl, customerEmail: email });
      if (res.alreadyPaid) return reply.code(200).send({ alreadyPaid: true });
      return reply.code(201).send({ url: res.url });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // Stripe webhook. Verifies the signature over the RAW body, then on a completed
  // checkout books revenue + auto-delivers (idempotent). 200 on anything else so
  // Stripe's delivery log stays green.
  app.post("/webhooks/stripe", async (req, reply) => {
    const raw = (req as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    const ok = verifyStripeSignature(process.env.STRIPE_WEBHOOK_SECRET, raw, req.headers["stripe-signature"]);
    if (!ok) return reply.code(401).send({ error: "invalid signature" });
    const event = (req.body ?? {}) as { type?: string; data?: { object?: { client_reference_id?: string; amount_total?: number } } };
    if (event.type === "checkout.session.completed") {
      const obj = event.data?.object ?? {};
      if (obj.client_reference_id) {
        const r = await fulfillPaidQuote(d.db, { quoteId: obj.client_reference_id, amountTotalCents: obj.amount_total });
        return reply.code(200).send(r);
      }
    }
    return reply.code(200).send({ ok: true, ignored: event.type ?? "unknown" });
  });
}
