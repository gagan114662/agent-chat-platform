import { count, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { plans, subscriptions, members, agents, messages, tasks } from "../db/schema.js";

// #85 plans/quotas. Pricing tiers live in the `plans` table (seeded by the
// 0027_billing migration); an org's tier is its `subscriptions` row. Orgs with
// no subscription default to the Starter (free) tier so existing orgs keep
// working without a backfill.

export const STARTER_PLAN_ID = "starter";

export type Plan = typeof plans.$inferSelect;
export type QuotaKind = "seats" | "agents" | "messages" | "tasks";

export interface Quota { used: number; limit: number; ok: boolean }

// The per-resource limit on a plan for a given quota kind. `-1` = unlimited.
function planLimit(plan: Plan, kind: QuotaKind): number {
  switch (kind) {
    case "seats": return plan.seatLimit;
    case "agents": return plan.agentLimit;
    case "messages": return plan.messageQuota;
    case "tasks": return plan.taskQuota;
  }
}

// currentPlan returns the org's subscription plan, defaulting to Starter when
// the org has no subscription row (or its planId no longer resolves to a tier).
export async function currentPlan(db: DB, orgId: string): Promise<Plan> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
  const planId = sub?.planId ?? STARTER_PLAN_ID;
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (plan) return plan;
  // Fall back to Starter if the subscribed plan id is unknown (defensive).
  const [starter] = await db.select().from(plans).where(eq(plans.id, STARTER_PLAN_ID));
  return starter;
}

export interface Usage { seats: number; agents: number; messages: number; tasks: number }

// usage counts the org's current resource consumption (org-scoped).
export async function usage(db: DB, orgId: string): Promise<Usage> {
  const [seats] = await db.select({ n: count() }).from(members).where(eq(members.orgId, orgId));
  const [agentCount] = await db.select({ n: count() }).from(agents).where(eq(agents.orgId, orgId));
  const [messageCount] = await db.select({ n: count() }).from(messages).where(eq(messages.orgId, orgId));
  const [taskCount] = await db.select({ n: count() }).from(tasks).where(eq(tasks.orgId, orgId));
  return {
    seats: Number(seats.n),
    agents: Number(agentCount.n),
    messages: Number(messageCount.n),
    tasks: Number(taskCount.n),
  };
}

// checkQuota reports {used, limit, ok} for one resource against the org's plan.
// `ok` = limit < 0 (unlimited) || used < limit — i.e. there's room to add one more.
export async function checkQuota(db: DB, orgId: string, kind: QuotaKind): Promise<Quota> {
  const plan = await currentPlan(db, orgId);
  const u = await usage(db, orgId);
  const used = u[kind];
  const limit = planLimit(plan, kind);
  const ok = limit < 0 || used < limit;
  return { used, limit, ok };
}

// setSubscription upserts the org's subscription row (orgId is the PK). Only the
// provided Stripe/status fields are written; planId is always set.
export async function setSubscription(
  db: DB,
  s: { orgId: string; planId: string; stripeCustomerId?: string | null; stripeSubId?: string | null; status?: string; currentPeriodEnd?: Date | null },
): Promise<void> {
  const set: Record<string, unknown> = { planId: s.planId };
  if (s.status !== undefined) set.status = s.status;
  if (s.stripeCustomerId !== undefined) set.stripeCustomerId = s.stripeCustomerId;
  if (s.stripeSubId !== undefined) set.stripeSubId = s.stripeSubId;
  if (s.currentPeriodEnd !== undefined) set.currentPeriodEnd = s.currentPeriodEnd;

  await db.insert(subscriptions).values({
    orgId: s.orgId,
    planId: s.planId,
    status: s.status ?? "active",
    stripeCustomerId: s.stripeCustomerId ?? null,
    stripeSubId: s.stripeSubId ?? null,
    currentPeriodEnd: s.currentPeriodEnd ?? null,
  }).onConflictDoUpdate({ target: subscriptions.orgId, set });
}

// listPlans returns the available tiers (ascending by seat limit; unlimited
// last). Reference data — used by GET /billing/plans.
export async function listPlans(db: DB): Promise<Plan[]> {
  const rows = await db.select().from(plans);
  return rows.sort((a, b) => {
    const sa = a.seatLimit < 0 ? Number.POSITIVE_INFINITY : a.seatLimit;
    const sb = b.seatLimit < 0 ? Number.POSITIVE_INFINITY : b.seatLimit;
    return sa - sb;
  });
}
