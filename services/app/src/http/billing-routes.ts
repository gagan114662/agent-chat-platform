import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { roleOf, can } from "../rbac/rbac.js";
import { currentPlan, usage, checkQuota, listPlans, type QuotaKind } from "../billing/plans.js";
import { defaultStripe, type MakeStripe } from "../billing/billing.js";
import { plans, subscriptions } from "../db/schema.js";

const QUOTA_KINDS: QuotaKind[] = ["seats", "agents", "messages", "tasks"];

// #85 billing routes: usage/quota visibility + Stripe Checkout (upgrade) and
// Billing Portal (manage). The Stripe client factory is injectable (`makeStripe`)
// so tests pass a fake returning a URL — NO live Stripe calls in tests. When no
// factory is injected the live `defaultStripe` is used, which throws (→ 400)
// unless STRIPE_API_KEY is set. Checkout/portal are admin-gated (team:manage)
// and everything is org-scoped (actor(req).orgId).
export function registerBillingRoutes(app: FastifyInstance, d: { db: DB; makeStripe?: MakeStripe }) {
  // The org's current plan + usage + per-resource quotas.
  app.get("/billing", async (req) => {
    const { orgId } = actor(req);
    const plan = await currentPlan(d.db, orgId);
    const u = await usage(d.db, orgId);
    const quotas = Object.fromEntries(
      await Promise.all(QUOTA_KINDS.map(async (k) => [k, await checkQuota(d.db, orgId, k)] as const)),
    );
    return { plan, usage: u, quotas };
  });

  // The available pricing tiers (reference data).
  app.get("/billing/plans", async () => {
    return listPlans(d.db);
  });

  // Build a Stripe Checkout Session for the chosen plan's stripePriceId (admin).
  // 400 when the plan has no priceId or Stripe isn't configured.
  app.post("/billing/checkout", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { planId } = (req.body ?? {}) as { planId?: string };
    if (!planId?.trim()) return reply.code(400).send({ error: "planId required" });

    const [plan] = await d.db.select().from(plans).where(eq(plans.id, planId));
    if (!plan) return reply.code(400).send({ error: "unknown plan" });
    if (!plan.stripePriceId) return reply.code(400).send({ error: "plan is not purchasable (no Stripe price)" });

    // Reuse the org's existing Stripe customer if we have one.
    const [sub] = await d.db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));

    let stripe;
    try {
      stripe = (d.makeStripe ?? defaultStripe)();
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    try {
      const { url } = await stripe.createCheckoutSession({ priceId: plan.stripePriceId, orgId, customerId: sub?.stripeCustomerId });
      return reply.code(200).send({ url });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // Build a Stripe Billing Portal Session for the org's customer (admin). 400 if
  // the org has no stripeCustomerId yet (nothing to manage) or Stripe is unconfigured.
  app.post("/billing/portal", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const [sub] = await d.db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
    if (!sub?.stripeCustomerId) return reply.code(400).send({ error: "no billing customer for this org" });

    let stripe;
    try {
      stripe = (d.makeStripe ?? defaultStripe)();
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    try {
      const { url } = await stripe.createPortalSession({ customerId: sub.stripeCustomerId });
      return reply.code(200).send({ url });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
}
