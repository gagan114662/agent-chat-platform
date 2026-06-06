import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { roleOf, can } from "../rbac/rbac.js";
import {
  createBusiness, listBusinesses, getBusiness, businessPnl, addLedgerEntry,
  createPaymentIntent, listPaymentIntents, decidePaymentIntent,
  addLead, funnel, createCampaign, listCampaigns, decideCampaign,
} from "../business/businesses.js";
import {
  createOffering, listOfferings, createQuote, listQuotes, checkoutQuote,
  QuoteChargeMismatchError,
} from "../business/catalog.js";
import { listDeliveries, fulfillDelivery } from "../business/delivery.js";
import { incomeStatement, portfolioPnl } from "../business/accounting.js";
import { openTicket, listTickets, resolveTicket } from "../business/support.js";

// #141/#142 business routes. Drafts (create business / payment intent / campaign /
// lead / cost) are member-allowed; APPROVING a payment or a campaign is admin-gated
// (team:manage) — that approval is the human money/outreach gate (#110/#125).
export function registerBusinessRoutes(app: FastifyInstance, d: { db: DB }) {
  const isAdmin = async (userId: string, orgId: string) => can(await roleOf(d.db, userId, orgId), "team:manage");

  app.get("/businesses", async (req, reply) => {
    const { orgId } = actor(req);
    return reply.code(200).send({ businesses: await listBusinesses(d.db, orgId) });
  });
  app.post("/businesses", async (req, reply) => {
    const { orgId } = actor(req);
    const { name, repoId } = (req.body ?? {}) as { name?: string; repoId?: string };
    if (!name?.trim()) return reply.code(400).send({ error: "name required" });
    return reply.code(201).send(await createBusiness(d.db, { orgId, name: name.trim(), repoId }));
  });

  // P&L + funnel + payment intents + campaigns for one business (the dashboard).
  app.get("/businesses/:id", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const b = await getBusiness(d.db, orgId, id);
    if (!b) return reply.code(404).send({ error: "business not found" });
    const [pnl, fun, intents, campaigns] = await Promise.all([
      businessPnl(d.db, orgId, id), funnel(d.db, orgId, id),
      listPaymentIntents(d.db, orgId, id), listCampaigns(d.db, orgId, id),
    ]);
    return reply.code(200).send({ business: b, pnl, funnel: fun, paymentIntents: intents, campaigns });
  });

  // Cost attribution (#141): record a cost line (agent/model spend, infra, api).
  app.post("/businesses/:id/ledger", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const { kind, amountCents, source, memo } = (req.body ?? {}) as { kind?: string; amountCents?: number; source?: string; memo?: string };
    if (kind !== "revenue" && kind !== "cost") return reply.code(400).send({ error: "kind must be revenue|cost" });
    if (typeof amountCents !== "number") return reply.code(400).send({ error: "amountCents required" });
    return reply.code(201).send(await addLedgerEntry(d.db, { orgId, businessId: id, kind, amountCents, source: source ?? "manual", memo }));
  });

  // ---- human-gated revenue rails (#141) ----
  app.post("/businesses/:id/payment-intents", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const { amountCents, customer, memo } = (req.body ?? {}) as { amountCents?: number; customer?: string; memo?: string };
    if (typeof amountCents !== "number" || amountCents <= 0) return reply.code(400).send({ error: "amountCents > 0 required" });
    return reply.code(201).send(await createPaymentIntent(d.db, { orgId, businessId: id, amountCents, customer, memo }));
  });
  app.post("/payment-intents/:id/decide", async (req, reply) => {
    const { orgId, userId } = actor(req);
    const { id } = req.params as { id: string };
    const { approve } = (req.body ?? {}) as { approve?: boolean };
    if (typeof approve !== "boolean") return reply.code(400).send({ error: "approve (boolean) required" });
    if (!(await isAdmin(userId, orgId))) return reply.code(403).send({ error: "forbidden — approving a charge is the human money gate (admin only)" });
    const row = await decidePaymentIntent(d.db, { orgId, intentId: id, approve, byUserId: userId });
    if (!row) return reply.code(404).send({ error: "payment intent not found" });
    return reply.code(200).send(row);
  });

  // ---- CRM / funnel (#142) ----
  app.post("/businesses/:id/leads", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const { identifier, stage, source } = (req.body ?? {}) as { identifier?: string; stage?: "visitor" | "signup" | "customer"; source?: string };
    if (!identifier?.trim()) return reply.code(400).send({ error: "identifier required" });
    return reply.code(201).send(await addLead(d.db, { orgId, businessId: id, identifier: identifier.trim(), stage, source }));
  });

  // ---- human-gated acquisition (#142) ----
  app.post("/businesses/:id/campaigns", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const { channel, audience, body } = (req.body ?? {}) as { channel?: string; audience?: string; body?: string };
    if (channel !== "email" && channel !== "social" && channel !== "ads") return reply.code(400).send({ error: "channel must be email|social|ads" });
    return reply.code(201).send(await createCampaign(d.db, { orgId, businessId: id, channel, audience, body }));
  });
  app.post("/campaigns/:id/decide", async (req, reply) => {
    const { orgId, userId } = actor(req);
    const { id } = req.params as { id: string };
    const { approve, costCents } = (req.body ?? {}) as { approve?: boolean; costCents?: number };
    if (typeof approve !== "boolean") return reply.code(400).send({ error: "approve (boolean) required" });
    if (!(await isAdmin(userId, orgId))) return reply.code(403).send({ error: "forbidden — approving outreach to real people is the human gate (admin only)" });
    const row = await decideCampaign(d.db, { orgId, campaignId: id, approve, byUserId: userId, costCents });
    if (!row) return reply.code(404).send({ error: "campaign not found" });
    return reply.code(200).send(row);
  });

  // ---- #152 2.1 catalog ----
  app.get("/businesses/:id/offerings", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    return reply.code(200).send({ offerings: await listOfferings(d.db, orgId, id) });
  });
  app.post("/businesses/:id/offerings", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const { sku, name, deliverable, scope, priceCents } = (req.body ?? {}) as { sku?: string; name?: string; deliverable?: string; scope?: string; priceCents?: number };
    if (!sku?.trim() || !name?.trim()) return reply.code(400).send({ error: "sku and name required" });
    if (typeof priceCents !== "number" || priceCents <= 0) return reply.code(400).send({ error: "priceCents > 0 required" });
    return reply.code(201).send(await createOffering(d.db, { orgId, businessId: id, sku: sku.trim(), name: name.trim(), deliverable, scope, priceCents }));
  });

  // ---- #152 2.2 quoting ----
  app.get("/businesses/:id/quotes", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    return reply.code(200).send({ quotes: await listQuotes(d.db, orgId, id) });
  });
  // A quote derives its price from the offering — the client never sends an amount,
  // so a wrong number has nowhere to enter.
  app.post("/businesses/:id/quotes", async (req, reply) => {
    const { orgId } = actor(req);
    const { offeringId, customer } = (req.body ?? {}) as { offeringId?: string; customer?: string };
    if (!offeringId?.trim()) return reply.code(400).send({ error: "offeringId required" });
    try {
      return reply.code(201).send(await createQuote(d.db, { orgId, offeringId: offeringId.trim(), customer }));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---- #152 3.1 checkout (guardrail: charge === quote, #152 6.2) ----
  // Resolve a quote to a payment intent for EXACTLY the quoted amount. The intent
  // still needs a human to approve (the money gate). The returned paymentIntent.id is
  // the real, correctly-priced target a Buy link points at — never a placeholder.
  app.post("/quotes/:id/checkout", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    try {
      return reply.code(201).send(await checkoutQuote(d.db, { orgId, quoteId: id }));
    } catch (e) {
      if (e instanceof QuoteChargeMismatchError) return reply.code(409).send({ error: e.message, quotedCents: e.quotedCents, chargeCents: e.chargeCents });
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---- #152 5.1 delivery ----
  // A pending delivery is auto-created when a payment is approved (see
  // decidePaymentIntent). Fulfilling hands the artifact over (deployed URL by default).
  app.get("/businesses/:id/deliveries", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    return reply.code(200).send({ deliveries: await listDeliveries(d.db, orgId, id) });
  });
  app.post("/deliveries/:id/fulfill", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const { artifact, kind } = (req.body ?? {}) as { artifact?: string; kind?: string };
    const row = await fulfillDelivery(d.db, { orgId, deliveryId: id, artifact, kind });
    if (!row) return reply.code(404).send({ error: "delivery not found" });
    return reply.code(200).send(row);
  });

  // ---- #152 8.2 accounting ----
  app.get("/businesses/:id/accounting", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const b = await getBusiness(d.db, orgId, id);
    if (!b) return reply.code(404).send({ error: "business not found" });
    return reply.code(200).send(await incomeStatement(d.db, orgId, id));
  });
  app.get("/accounting/portfolio", async (req, reply) => {
    const { orgId } = actor(req);
    return reply.code(200).send(await portfolioPnl(d.db, orgId));
  });

  // ---- #152 7.1 support ----
  app.get("/businesses/:id/support", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const { state } = (req.query ?? {}) as { state?: "open" | "resolved" };
    return reply.code(200).send({ tickets: await listTickets(d.db, orgId, id, { state }) });
  });
  app.post("/businesses/:id/support", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const { customer, subject, body } = (req.body ?? {}) as { customer?: string; subject?: string; body?: string };
    if (!body?.trim()) return reply.code(400).send({ error: "body required" });
    return reply.code(201).send(await openTicket(d.db, { orgId, businessId: id, customer, subject, body: body.trim() }));
  });
  app.post("/support/:id/resolve", async (req, reply) => {
    const { orgId, userId } = actor(req);
    const { id } = req.params as { id: string };
    const { resolution } = (req.body ?? {}) as { resolution?: string };
    const row = await resolveTicket(d.db, { orgId, ticketId: id, resolution: resolution ?? "", byActor: userId });
    if (!row) return reply.code(404).send({ error: "ticket not found" });
    return reply.code(200).send(row);
  });
}
