import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import type { DB } from "../db/client.js";
import {
  businesses, businessLedger, paymentIntents, leads, outreachCampaigns, repos, tasks,
} from "../db/schema.js";
import { record } from "../audit/audit-log.js";

// #146: when a human approves a draft a goal task created, that task's real outcome
// is verified → mark it done (#145). Inline (not imported) to avoid a cycle.
async function verifyDraftTask(db: DB, orgId: string, taskId: string | null | undefined) {
  if (!taskId) return;
  await db.update(tasks).set({ state: "done" }).where(and(eq(tasks.orgId, orgId), eq(tasks.id, taskId), eq(tasks.state, "merged")));
}

// #141/#142 the business subsystem. A first-class business bundles a repo (#139),
// a live URL (#140), a per-business P&L, a CRM funnel, and human-gated revenue +
// acquisition. HARD BOUNDARY: agents draft payment intents and outreach campaigns;
// only a human approves them (no real money moved / no message sent on agents' own).

// ---- entity ----
export async function createBusiness(db: DB, args: { orgId: string; name: string; repoId?: string }) {
  let liveUrl: string | null = null;
  if (args.repoId) {
    const [r] = await db.select({ liveUrl: repos.liveUrl }).from(repos).where(and(eq(repos.id, args.repoId), eq(repos.orgId, args.orgId)));
    liveUrl = r?.liveUrl ?? null;
  }
  const [row] = await db.insert(businesses).values({
    id: randomUUID(), orgId: args.orgId, name: args.name, repoId: args.repoId ?? null, liveUrl,
  }).returning();
  return row;
}
export async function listBusinesses(db: DB, orgId: string) {
  return db.select().from(businesses).where(eq(businesses.orgId, orgId)).orderBy(desc(businesses.createdAt));
}
export async function getBusiness(db: DB, orgId: string, id: string) {
  const [row] = await db.select().from(businesses).where(and(eq(businesses.id, id), eq(businesses.orgId, orgId)));
  return row;
}

// ---- P&L (#141) ----
export type LedgerKind = "revenue" | "cost";
export async function addLedgerEntry(db: DB, args: { orgId: string; businessId: string; kind: LedgerKind; amountCents: number; source: string; memo?: string }) {
  const [row] = await db.insert(businessLedger).values({
    id: randomUUID(), orgId: args.orgId, businessId: args.businessId, kind: args.kind,
    amountCents: Math.round(args.amountCents), source: args.source, memo: args.memo ?? "",
  }).returning();
  return row;
}
export interface Pnl { revenueCents: number; costCents: number; netCents: number; profitable: boolean }
export async function businessPnl(db: DB, orgId: string, businessId: string): Promise<Pnl> {
  const rows = await db.select().from(businessLedger).where(and(eq(businessLedger.orgId, orgId), eq(businessLedger.businessId, businessId)));
  let revenueCents = 0, costCents = 0;
  for (const r of rows) (r.kind === "revenue" ? (revenueCents += r.amountCents) : (costCents += r.amountCents));
  const netCents = revenueCents - costCents;
  return { revenueCents, costCents, netCents, profitable: netCents > 0 };
}

// ---- human-gated revenue rails (#141) ----
// Agents create a payment intent (draft); it stays pending until a human approves.
export async function createPaymentIntent(db: DB, args: { orgId: string; businessId: string; amountCents: number; customer?: string; memo?: string; taskId?: string }) {
  const [row] = await db.insert(paymentIntents).values({
    id: randomUUID(), orgId: args.orgId, businessId: args.businessId,
    amountCents: Math.round(args.amountCents), customer: args.customer ?? "", memo: args.memo ?? "", state: "pending",
    taskId: args.taskId ?? null,
  }).returning();
  return row;
}
export async function listPaymentIntents(db: DB, orgId: string, businessId: string) {
  return db.select().from(paymentIntents).where(and(eq(paymentIntents.orgId, orgId), eq(paymentIntents.businessId, businessId))).orderBy(desc(paymentIntents.createdAt));
}
// decidePaymentIntent: a HUMAN approves/declines. Approval posts a 'revenue' line
// AND marks the customer a paying lead. This is the money gate (#110/#125): the
// approval is the only thing that turns a draft into real revenue.
export async function decidePaymentIntent(db: DB, args: { orgId: string; intentId: string; approve: boolean; byUserId: string }) {
  const [pi] = await db.select().from(paymentIntents).where(and(eq(paymentIntents.id, args.intentId), eq(paymentIntents.orgId, args.orgId)));
  if (!pi) return undefined;
  if (pi.state !== "pending") return pi; // idempotent
  const state = args.approve ? "approved" : "declined";
  const [row] = await db.update(paymentIntents).set({ state, approvedBy: args.byUserId })
    .where(and(eq(paymentIntents.id, args.intentId), eq(paymentIntents.orgId, args.orgId))).returning();
  if (args.approve) {
    await addLedgerEntry(db, { orgId: args.orgId, businessId: pi.businessId, kind: "revenue", amountCents: pi.amountCents, source: "payment", memo: `payment ${pi.customer}`.trim() });
    if (pi.customer) await addLead(db, { orgId: args.orgId, businessId: pi.businessId, identifier: pi.customer, stage: "customer", source: "payment" });
    await verifyDraftTask(db, args.orgId, pi.taskId); // #146: close the goal task that drafted this
    // #152 5.1: a paid customer is owed delivery — open a pending delivery now.
    // Inline import to avoid a module cycle (delivery imports nothing from here).
    const { createDelivery } = await import("./delivery.js");
    await createDelivery(db, { orgId: args.orgId, businessId: pi.businessId, customer: pi.customer, paymentIntentId: pi.id });
  }
  // #150.3: tamper-evident record of the money decision (who, what, how much).
  await record(db, { orgId: args.orgId, actorKind: "human", actorId: args.byUserId, action: args.approve ? "payment.approved" : "payment.declined", resource: pi.businessId, payload: { amountCents: pi.amountCents, customer: pi.customer } });
  return row;
}

// ---- CRM / funnel (#142) ----
export type LeadStage = "visitor" | "signup" | "customer";
export async function addLead(db: DB, args: { orgId: string; businessId: string; identifier: string; stage?: LeadStage; source?: string }) {
  const [row] = await db.insert(leads).values({
    id: randomUUID(), orgId: args.orgId, businessId: args.businessId,
    identifier: args.identifier, stage: args.stage ?? "visitor", source: args.source ?? "",
  }).returning();
  return row;
}
export interface Funnel { visitor: number; signup: number; customer: number }
export async function funnel(db: DB, orgId: string, businessId: string): Promise<Funnel> {
  const rows = await db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.businessId, businessId)));
  const f: Funnel = { visitor: 0, signup: 0, customer: 0 };
  for (const r of rows) if (r.stage in f) f[r.stage as LeadStage]++;
  return f;
}

// ---- human-gated acquisition (#142) ----
// A connector actually delivers an approved campaign. Injectable: the default is a
// no-op that reports how many it WOULD reach (real email/social/ads send needs the
// operator's accounts + creds — agents never send on their own). Returns reach count.
export type OutreachConnector = (c: { channel: string; audience: string; body: string }) => Promise<number>;
export const noopConnector: OutreachConnector = async (c) => c.audience.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).length;

export async function createCampaign(db: DB, args: { orgId: string; businessId: string; channel: string; audience?: string; body?: string; taskId?: string }) {
  const [row] = await db.insert(outreachCampaigns).values({
    id: randomUUID(), orgId: args.orgId, businessId: args.businessId, channel: args.channel,
    audience: args.audience ?? "", body: args.body ?? "", state: "pending",
    taskId: args.taskId ?? null,
  }).returning();
  return row;
}
export async function listCampaigns(db: DB, orgId: string, businessId: string) {
  return db.select().from(outreachCampaigns).where(and(eq(outreachCampaigns.orgId, orgId), eq(outreachCampaigns.businessId, businessId))).orderBy(desc(outreachCampaigns.createdAt));
}
// decideCampaign: a HUMAN approves/declines. On approval the connector delivers it
// (default no-op), records each reached address as a 'visitor' lead (funnel input),
// and books any cost. Sending to real people is high-stakes (#125) → human-gated.
export async function decideCampaign(db: DB, args: { orgId: string; campaignId: string; approve: boolean; byUserId: string; connector?: OutreachConnector; costCents?: number }) {
  const [c] = await db.select().from(outreachCampaigns).where(and(eq(outreachCampaigns.id, args.campaignId), eq(outreachCampaigns.orgId, args.orgId)));
  if (!c) return undefined;
  if (c.state !== "pending") return c;
  if (!args.approve) {
    const [row] = await db.update(outreachCampaigns).set({ state: "declined", approvedBy: args.byUserId })
      .where(and(eq(outreachCampaigns.id, args.campaignId), eq(outreachCampaigns.orgId, args.orgId))).returning();
    return row;
  }
  const reached = await (args.connector ?? noopConnector)({ channel: c.channel, audience: c.audience, body: c.body });
  const addrs = c.audience.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  for (const a of addrs) await addLead(db, { orgId: args.orgId, businessId: c.businessId, identifier: a, stage: "visitor", source: c.channel });
  if (args.costCents) await addLedgerEntry(db, { orgId: args.orgId, businessId: c.businessId, kind: "cost", amountCents: args.costCents, source: "api", memo: `${c.channel} campaign` });
  const [row] = await db.update(outreachCampaigns).set({ state: "sent", approvedBy: args.byUserId, sentCount: reached })
    .where(and(eq(outreachCampaigns.id, args.campaignId), eq(outreachCampaigns.orgId, args.orgId))).returning();
  await verifyDraftTask(db, args.orgId, c.taskId); // #146: close the goal task that drafted this
  await record(db, { orgId: args.orgId, actorKind: "human", actorId: args.byUserId, action: "outreach.sent", resource: c.businessId, payload: { channel: c.channel, reached } });
  return row;
}
