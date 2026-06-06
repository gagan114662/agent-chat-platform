import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { gtmActions, businesses, offerings, leads } from "../db/schema.js";
import { addLedgerEntry } from "../business/businesses.js";
import { record } from "../audit/audit-log.js";
import { playbooksFor, type GtmFunction, type GtmPlaybook } from "./playbooks.js";

// #41 the autonomous GTM motion. Runs the adopted gtm-cheat-codes playbooks for a
// business and EXECUTES each one with NO human-in-the-loop approval gate (operator's
// explicit choice). Autonomy is not opacity: every action is recorded in gtm_actions
// and the hash-chained audit log. The only remaining gate is capability — a real
// `sent` requires an operator-provisioned connector (Zapier MCP); the default no-op
// records intent without physically sending, so wiring real creds = autonomous live.

export interface GtmAction {
  fn: GtmFunction;
  skill: string;
  actionKind: string;
  summary: string;
  payload: Record<string, unknown>;
  audienceSize: number;
}
// The connector is the seam to Zapier MCP (docs/zapier-mcp-sdk-patterns). Real impl
// calls MCP tool actions (Gmail/CRM/Slack/...). Default no-op: records intent, sends
// nothing (reach = intended audience, sent = false).
export type GtmConnector = (a: GtmAction) => Promise<{ sent: boolean; reach: number }>;
export const noopGtmConnector: GtmConnector = async (a) => ({ sent: false, reach: a.audienceSize });

// Deterministic action generator: turn a playbook + business context into a concrete,
// review-free action. A production upgrade swaps in the LLM gateway (#147) for the copy;
// the SHAPE (what effect each action kind has) stays the same.
function buildAction(pb: GtmPlaybook, ctx: { name: string; offer?: string; priceCents?: number; liveUrl?: string | null; audienceSize: number }): GtmAction {
  const price = ctx.priceCents != null ? `$${(ctx.priceCents / 100).toFixed(2)}` : "the listed price";
  const offer = ctx.offer ?? ctx.name;
  const base = { fn: pb.fn, skill: pb.id, actionKind: pb.actionKind, audienceSize: ctx.audienceSize };
  switch (pb.actionKind) {
    case "outreach":
      return { ...base, summary: `Demand-gen push for ${ctx.name}: ${offer} at ${price}`, payload: { channel: "email", offer, price, cta: ctx.liveUrl ?? "(offer page)" } };
    case "sequence":
      return { ...base, summary: `3-step outbound sequence for ${ctx.name} (${offer})`, payload: { steps: ["intro", "value + proof", "offer + CTA"], offer } };
    case "content":
      return { ...base, summary: `${pb.name}: asset for ${ctx.name} (${offer})`, payload: { kind: pb.id, offer } };
    case "social-proof":
      return { ...base, summary: `Curated approved customer proof for ${ctx.name}`, payload: { uses: ["landing page", "outbound", "deck"] } };
    case "audit":
      return { ...base, summary: `${pb.name}: ${ctx.name} lead/CX audit`, payload: { scope: "form-fill → follow-up" } };
    case "triage":
      return { ...base, summary: `${pb.name}: routed inbound action list for ${ctx.name}`, payload: {} };
    default:
      return { ...base, summary: `${pb.name} for ${ctx.name}`, payload: {} };
  }
}

export interface GtmRunResult {
  businessId: string;
  ran: number;
  sent: number;
  costCents: number;
  actions: { skill: string; fn: GtmFunction; actionKind: string; summary: string; sent: boolean; reach: number }[];
}

export async function runGtmMotion(db: DB, args: {
  orgId: string; businessId: string; fn?: GtmFunction;
  connector?: GtmConnector; costPerActionCents?: number; byId?: string;
}): Promise<GtmRunResult> {
  const { orgId, businessId } = args;
  const connector = args.connector ?? noopGtmConnector;
  const costPer = args.costPerActionCents ?? 5; // small per-action GTM spend → shows in P&L (#155)

  const [biz] = await db.select().from(businesses).where(and(eq(businesses.id, businessId), eq(businesses.orgId, orgId)));
  if (!biz) throw new Error("business not found");
  const [offer] = await db.select().from(offerings).where(and(eq(offerings.orgId, orgId), eq(offerings.businessId, businessId), eq(offerings.active, true)));
  const audience = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.orgId, orgId), eq(leads.businessId, businessId)));
  const ctx = { name: biz.name, offer: offer?.name, priceCents: offer?.priceCents, liveUrl: biz.liveUrl, audienceSize: audience.length };

  const playbooks = playbooksFor(args.fn);
  const out: GtmRunResult["actions"] = [];
  let sentCount = 0, costCents = 0;
  for (const pb of playbooks) {
    const action = buildAction(pb, ctx);
    const result = await connector(action); // EXECUTE — no human gate
    // spend is booked for the channels that actually cost money to run.
    if ((pb.actionKind === "outreach" || pb.actionKind === "sequence") && costPer > 0) {
      await addLedgerEntry(db, { orgId, businessId, kind: "cost", amountCents: costPer, source: "gtm", memo: `gtm:${pb.id}` });
      costCents += costPer;
    }
    await db.insert(gtmActions).values({
      id: randomUUID(), orgId, businessId, fn: pb.fn, skill: pb.id, actionKind: pb.actionKind,
      summary: action.summary, payload: action.payload, sent: result.sent, reach: result.reach,
    });
    await record(db, { orgId, actorKind: "agent", actorId: args.byId ?? "gtm", action: "gtm.executed", resource: businessId, payload: { skill: pb.id, fn: pb.fn, sent: result.sent, reach: result.reach } });
    if (result.sent) sentCount++;
    out.push({ skill: pb.id, fn: pb.fn, actionKind: pb.actionKind, summary: action.summary, sent: result.sent, reach: result.reach });
  }
  return { businessId, ran: out.length, sent: sentCount, costCents, actions: out };
}

export async function listGtmActions(db: DB, orgId: string, businessId: string) {
  return db.select().from(gtmActions).where(and(eq(gtmActions.orgId, orgId), eq(gtmActions.businessId, businessId)));
}
