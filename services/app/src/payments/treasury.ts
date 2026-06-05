import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { treasuryLedger, invoices } from "../db/schema.js";

// #118 inbound revenue (software side). Live money capture is the billing/Stripe
// processor (#85) under the operator's account; this records what came in/out so
// the treasury balance + reconciliation (#115) are first-class. NO real funds move
// here — `markInvoicePaid`/`recordRevenue` are called by the processor webhook.

export type LedgerSource = "invoice" | "subscription" | "checkout" | "agent_payout" | "manual";

export async function recordRevenue(db: DB, i: { orgId: string; amountCents: number; source: LedgerSource; ref?: string }) {
  const [row] = await db.insert(treasuryLedger).values({
    id: randomUUID(), orgId: i.orgId, direction: "credit", amountCents: i.amountCents, source: i.source, ref: i.ref ?? null,
  }).returning();
  return row;
}

export async function recordDebit(db: DB, i: { orgId: string; amountCents: number; source: LedgerSource; ref?: string }) {
  const [row] = await db.insert(treasuryLedger).values({
    id: randomUUID(), orgId: i.orgId, direction: "debit", amountCents: i.amountCents, source: i.source, ref: i.ref ?? null,
  }).returning();
  return row;
}

// treasuryBalanceCents = sum(credits) - sum(debits) for the org.
export async function treasuryBalanceCents(db: DB, orgId: string): Promise<number> {
  const [r] = await db.select({
    balance: sql<number>`coalesce(sum(case when ${treasuryLedger.direction} = 'credit' then ${treasuryLedger.amountCents} else -${treasuryLedger.amountCents} end), 0)`,
  }).from(treasuryLedger).where(eq(treasuryLedger.orgId, orgId));
  return Number(r?.balance ?? 0);
}

export async function createInvoice(db: DB, i: { orgId: string; customer: string; amountCents: number }) {
  const [row] = await db.insert(invoices).values({
    id: randomUUID(), orgId: i.orgId, customer: i.customer, amountCents: i.amountCents, status: "draft",
  }).returning();
  return row;
}

export async function listInvoices(db: DB, orgId: string) {
  return db.select().from(invoices).where(eq(invoices.orgId, orgId));
}

// markInvoicePaid flips an invoice to paid and credits the treasury — the hook a
// processor webhook (#85) calls when payment settles. Idempotent: a paid invoice
// is not double-credited.
export async function markInvoicePaid(db: DB, orgId: string, invoiceId: string) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)));
  if (!inv) throw new Error(`invoice not found: ${invoiceId}`);
  if (inv.status === "paid") return inv; // already settled — no double credit
  const [updated] = await db.update(invoices)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)))
    .returning();
  await recordRevenue(db, { orgId, amountCents: inv.amountCents, source: "invoice", ref: invoiceId });
  return updated;
}
