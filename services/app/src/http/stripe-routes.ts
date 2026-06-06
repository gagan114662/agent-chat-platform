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

  // A real, catalog-priced, transactable offer page served BY the platform. Replaces
  // the static placeholder ("$19" + href="STRIPE_PAYMENT_LINK_HERE") with a price read
  // live from the catalog and a Buy button wired to /public/buy → Stripe. The GTM
  // motion can point its CTA straight here. Public; no money until the operator's key.
  app.get("/public/offer/:offeringId", async (req, reply) => {
    const { offeringId } = req.params as { offeringId: string };
    const [off] = await d.db.select().from(offerings).where(eq(offerings.id, offeringId));
    if (!off || !off.active) return reply.code(404).type("text/html").send("<!doctype html><meta charset=utf-8><title>Not available</title><p style='font:16px system-ui;padding:3rem'>This offer is not available.</p>");
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
    const priceNum = off.priceCents % 100 === 0 ? String(off.priceCents / 100) : (off.priceCents / 100).toFixed(2);
    const price = `$${priceNum}`;
    const html = `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(off.name)}</title><style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f0f11;color:#f0f0f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem 1rem}
.card{background:#1a1a1f;border:1px solid #2e2e38;border-radius:16px;max-width:520px;width:100%;padding:3rem 2.5rem;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.5)}
h1{font-size:1.6rem;margin-bottom:.5rem}.scope{color:#9aa;margin-bottom:1.5rem}
.price{font-size:3rem;font-weight:800;margin:1rem 0 .25rem}.price sup{font-size:1.3rem;top:-1.1rem;position:relative}
.note{color:#9aa;font-size:.85rem;margin-bottom:1.5rem}
input{width:100%;padding:.8rem 1rem;border-radius:10px;border:1px solid #2e2e38;background:#0f0f11;color:#f0f0f0;font-size:1rem;margin-bottom:.75rem}
button{width:100%;padding:.9rem;border:0;border-radius:10px;background:#2563eb;color:#fff;font-size:1rem;font-weight:700;cursor:pointer}
button:disabled{opacity:.5;cursor:default}.msg{margin-top:1rem;min-height:1.2rem;font-size:.9rem;color:#f87171}
</style></head><body><div class=card>
<h1>${esc(off.name)}</h1><div class=scope>${esc(off.scope || off.deliverable || "")}</div>
<div class=price><sup>$</sup>${priceNum}</div>
<div class=note>One-time · Instant checkout · secure payment via Stripe</div>
<input id=email type=email placeholder="you@email.com" autocomplete=email>
<button id=buy>Buy now — ${price}</button>
<div class=msg id=msg></div></div>
<script>
const btn=document.getElementById('buy'),msg=document.getElementById('msg');
btn.onclick=async()=>{btn.disabled=true;msg.textContent='';msg.style.color='#f87171';
 try{const r=await fetch('/public/buy/${off.id}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value||undefined})});
  const j=await r.json();
  if(r.ok&&j.url){window.location=j.url;return;}
  msg.textContent=j.error||'Could not start checkout.';}
 catch(e){msg.textContent='Network error, please retry.';}
 btn.disabled=false;};
</script></body></html>`;
    return reply.code(200).type("text/html").header("cache-control", "no-cache").send(html);
  });

  // Post-payment thank-you (Stripe success_url). Public. Shows the paid state + the
  // delivered artifact once the webhook has fulfilled it (may lag the redirect by a
  // moment — the page tells the buyer their deliverable is on its way).
  app.get("/public/thanks/:quoteId", async (req, reply) => {
    const { quoteId } = req.params as { quoteId: string };
    const [q] = await d.db.select().from(quotes).where(eq(quotes.id, quoteId));
    const paid = q?.state === "paid";
    const html = `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Thank you</title><style>
body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f0f11;color:#f0f0f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem 1rem;margin:0}
.card{background:#1a1a1f;border:1px solid #2e2e38;border-radius:16px;max-width:520px;width:100%;padding:3rem 2.5rem;text-align:center}
.tick{font-size:3rem;color:#34d399}h1{font-size:1.5rem;margin:.5rem 0}p{color:#9aa}
</style></head><body><div class=card>
<div class=tick>✓</div><h1>Payment received — thank you!</h1>
<p>${paid ? "Your purchase is confirmed and your deliverable is being prepared and sent to you now." : "We're confirming your payment. Your deliverable will be sent to you shortly."}</p>
</div></body></html>`;
    return reply.code(200).type("text/html").header("cache-control", "no-cache").send(html);
  });

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
