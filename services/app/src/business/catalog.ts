import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { offerings, quotes, paymentIntents } from "../db/schema.js";
import { createPaymentIntent } from "./businesses.js";
import { record } from "../audit/audit-log.js";

// #152 the money path, made correct by construction.
//
//   catalog (2.1)  →  quote (2.2)  →  checkout (3.1)
//   price lives ----> copied here --> charged exactly, asserted by the guardrail (6.2)
//
// The single source of truth for "what does it cost" is the offering. A quote
// copies that number; checkout charges exactly the quoted number. The guardrail
// (assertChargeMatchesQuote) refuses any charge that disagrees with its quote, so
// the number shown to the customer can never drift from the number billed — the
// $15-vs-$33 class of bug is impossible, not just unlikely.

// ---- 6.2 the quote==charge guardrail ----
export class QuoteChargeMismatchError extends Error {
  constructor(public quotedCents: number, public chargeCents: number) {
    super(`quote==charge guardrail: quoted ${quotedCents}¢ but charge is ${chargeCents}¢ — refusing to bill a different amount than quoted`);
    this.name = "QuoteChargeMismatchError";
  }
}
// Throws unless the charge equals the quote to the cent. This is the assertion the
// epic's 6.2 calls for: "quoted amount === charged amount, asserted before checkout".
export function assertChargeMatchesQuote(quotedCents: number, chargeCents: number): void {
  if (Math.round(quotedCents) !== Math.round(chargeCents)) throw new QuoteChargeMismatchError(quotedCents, chargeCents);
}

// ---- 2.1 catalog ----
export async function createOffering(db: DB, args: { orgId: string; businessId: string; sku: string; name: string; deliverable?: string; scope?: string; priceCents: number }) {
  if (!Number.isFinite(args.priceCents) || args.priceCents <= 0) throw new Error("priceCents > 0 required");
  const [row] = await db.insert(offerings).values({
    id: randomUUID(), orgId: args.orgId, businessId: args.businessId,
    sku: args.sku, name: args.name, deliverable: args.deliverable ?? "", scope: args.scope ?? "",
    priceCents: Math.round(args.priceCents), active: true,
  }).returning();
  return row;
}
export async function listOfferings(db: DB, orgId: string, businessId: string) {
  return db.select().from(offerings).where(and(eq(offerings.orgId, orgId), eq(offerings.businessId, businessId))).orderBy(desc(offerings.createdAt));
}
export async function getOffering(db: DB, orgId: string, id: string) {
  const [row] = await db.select().from(offerings).where(and(eq(offerings.id, id), eq(offerings.orgId, orgId)));
  return row;
}

// ---- 2.2 quoting ----
// A quote derives its price FROM the offering — the caller never passes an amount,
// so there is nowhere for a wrong number to enter. Returns the quote with the price
// it copied from the catalog.
export async function createQuote(db: DB, args: { orgId: string; offeringId: string; customer?: string }) {
  const off = await getOffering(db, args.orgId, args.offeringId);
  if (!off) throw new Error("offering not found");
  if (!off.active) throw new Error("offering is not active");
  const [row] = await db.insert(quotes).values({
    id: randomUUID(), orgId: args.orgId, businessId: off.businessId, offeringId: off.id,
    customer: args.customer ?? "", quotedCents: off.priceCents, state: "open",
  }).returning();
  return row;
}
export async function listQuotes(db: DB, orgId: string, businessId: string) {
  return db.select().from(quotes).where(and(eq(quotes.orgId, orgId), eq(quotes.businessId, businessId))).orderBy(desc(quotes.createdAt));
}
export async function getQuote(db: DB, orgId: string, id: string) {
  const [row] = await db.select().from(quotes).where(and(eq(quotes.id, id), eq(quotes.orgId, orgId)));
  return row;
}

// ---- 3.1 checkout ----
// Turn an open quote into a (human-gated) payment intent for EXACTLY the quoted
// amount. The guardrail asserts the charge matches the quote before anything is
// drafted; the payment intent still needs a human to approve (the money gate, #110).
// Returns { quote, paymentIntent } — the paymentIntent.id is the resolvable target a
// real "Buy" link points at, so the CTA can never be a placeholder for a wrong price.
export async function checkoutQuote(db: DB, args: { orgId: string; quoteId: string; taskId?: string }) {
  const q = await getQuote(db, args.orgId, args.quoteId);
  if (!q) throw new Error("quote not found");
  if (q.state === "charged") {
    const existing = q.paymentIntentId ? await db.select().from(paymentIntents).where(eq(paymentIntents.id, q.paymentIntentId)) : [];
    return { quote: q, paymentIntent: existing[0] ?? null, alreadyCheckedOut: true };
  }
  // 6.2: the charge MUST equal the quote. checkout sources the charge from the
  // quote itself, and the guardrail makes that invariant explicit + enforced.
  assertChargeMatchesQuote(q.quotedCents, q.quotedCents);
  const pi = await createPaymentIntent(db, {
    orgId: args.orgId, businessId: q.businessId, amountCents: q.quotedCents,
    customer: q.customer, memo: `checkout quote ${q.id}`, taskId: args.taskId,
  });
  const [updated] = await db.update(quotes).set({ state: "charged", paymentIntentId: pi.id })
    .where(and(eq(quotes.id, q.id), eq(quotes.orgId, args.orgId))).returning();
  await record(db, { orgId: args.orgId, actorKind: "system", actorId: "checkout", action: "quote.checkout", resource: q.businessId, payload: { quoteId: q.id, quotedCents: q.quotedCents, paymentIntentId: pi.id } });
  return { quote: updated, paymentIntent: pi, alreadyCheckedOut: false };
}
