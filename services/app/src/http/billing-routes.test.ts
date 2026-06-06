import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerBillingRoutes } from "./billing-routes.js";
import type { MakeStripe } from "../billing/billing.js";
import { setSubscription } from "../billing/plans.js";
import { orgs, workspaces, members, agents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// Fake Stripe: records the args it was called with and returns a deterministic url.
function fakeStripe() {
  const calls: { checkout: unknown[]; portal: unknown[] } = { checkout: [], portal: [] };
  const make: MakeStripe = () => ({
    async createCheckoutSession(args) { calls.checkout.push(args); return { url: `https://checkout.test/${(args as { priceId: string }).priceId}` }; },
    async createPortalSession(args) { calls.portal.push(args); return { url: "https://portal.test/session" }; },
    async createPaymentSession() { return { id: "cs_test", url: "https://checkout.test/payment" }; },
  });
  return { make, calls };
}

function makeApp(makeStripe?: MakeStripe) {
  const app = Fastify();
  registerBillingRoutes(app, { db: h.db, makeStripe });
  return app;
}

const admin = { "x-org-id": "o1", "x-user-id": "adm", "content-type": "application/json" };
const member = { "x-org-id": "o1", "x-user-id": "reg", "content-type": "application/json" };

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "o1", name: "O" }, { id: "o2", name: "O2" }]);
  await h.db.insert(workspaces).values([{ id: "w1", orgId: "o1", name: "W" }, { id: "w2", orgId: "o2", name: "W2" }]);
  await h.db.insert(members).values([
    { id: "adm", orgId: "o1", workspaceId: "w1", displayName: "Admin", role: "admin" },
    { id: "reg", orgId: "o1", workspaceId: "w1", displayName: "Reg", role: "member" },
    { id: "adm2", orgId: "o2", workspaceId: "w2", displayName: "Admin2", role: "admin" },
  ]);
});

describe("billing routes (#85)", () => {
  it("GET /billing returns plan + usage + per-resource quotas (default Starter)", async () => {
    const app = makeApp();
    await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "c1", displayName: "C1" });
    const res = await app.inject({ method: "GET", url: "/billing", headers: admin });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.id).toBe("starter");
    expect(body.usage.seats).toBe(2);
    expect(body.usage.agents).toBe(1);
    // quotas: each resource has {used, limit, ok}
    expect(body.quotas.agents).toEqual({ used: 1, limit: 3, ok: true }); // Starter = 3 agents (#107.5, migration 0036)
    expect(body.quotas.seats.used).toBe(2);
    expect(body.quotas).toHaveProperty("messages");
    expect(body.quotas).toHaveProperty("tasks");
    await app.close();
  });

  it("GET /billing reflects the org's subscription plan", async () => {
    await setSubscription(h.db, { orgId: "o1", planId: "pro" });
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/billing", headers: admin });
    expect(res.json().plan.id).toBe("pro");
    expect(res.json().quotas.agents.limit).toBe(25);
    await app.close();
  });

  it("GET /billing/plans lists the seeded tiers", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/billing/plans", headers: admin });
    expect(res.statusCode).toBe(200);
    const ids = res.json().map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["starter", "individual", "pro", "growth", "custom"]));
    await app.close();
  });

  it("POST /billing/checkout (admin) returns a url from the fake Stripe (called with the plan priceId)", async () => {
    // Give the pro plan a price id so checkout is buildable.
    await h.sql`update plans set stripe_price_id = 'price_pro' where id = 'pro'`;
    const fake = fakeStripe();
    const app = makeApp(fake.make);
    const res = await app.inject({ method: "POST", url: "/billing/checkout", headers: admin, payload: { planId: "pro" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe("https://checkout.test/price_pro");
    expect(fake.calls.checkout).toHaveLength(1);
    expect((fake.calls.checkout[0] as { priceId: string }).priceId).toBe("price_pro");
    expect((fake.calls.checkout[0] as { orgId: string }).orgId).toBe("o1");
    await app.close();
  });

  it("POST /billing/checkout as a non-admin → 403", async () => {
    await h.sql`update plans set stripe_price_id = 'price_pro' where id = 'pro'`;
    const fake = fakeStripe();
    const app = makeApp(fake.make);
    const res = await app.inject({ method: "POST", url: "/billing/checkout", headers: member, payload: { planId: "pro" } });
    expect(res.statusCode).toBe(403);
    expect(fake.calls.checkout).toHaveLength(0);
    await app.close();
  });

  it("POST /billing/checkout with a plan that has no priceId → 400", async () => {
    const fake = fakeStripe();
    const app = makeApp(fake.make);
    // starter has no stripe_price_id seeded
    const res = await app.inject({ method: "POST", url: "/billing/checkout", headers: admin, payload: { planId: "starter" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /billing/checkout with Stripe not configured (default factory, no key) → 400", async () => {
    await h.sql`update plans set stripe_price_id = 'price_pro' where id = 'pro'`;
    const prev = process.env.STRIPE_API_KEY;
    delete process.env.STRIPE_API_KEY;
    try {
      const app = makeApp(); // no makeStripe → defaultStripe, which throws when unconfigured
      const res = await app.inject({ method: "POST", url: "/billing/checkout", headers: admin, payload: { planId: "pro" } });
      expect(res.statusCode).toBe(400);
      await app.close();
    } finally {
      if (prev !== undefined) process.env.STRIPE_API_KEY = prev;
    }
  });

  it("POST /billing/portal (admin) returns a portal url for the org's customer", async () => {
    await setSubscription(h.db, { orgId: "o1", planId: "pro", stripeCustomerId: "cus_123" });
    const fake = fakeStripe();
    const app = makeApp(fake.make);
    const res = await app.inject({ method: "POST", url: "/billing/portal", headers: admin, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe("https://portal.test/session");
    expect((fake.calls.portal[0] as { customerId: string }).customerId).toBe("cus_123");
    await app.close();
  });

  it("POST /billing/portal with no stripeCustomerId → 400", async () => {
    const fake = fakeStripe();
    const app = makeApp(fake.make);
    const res = await app.inject({ method: "POST", url: "/billing/portal", headers: admin, payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /billing/portal as a non-admin → 403", async () => {
    await setSubscription(h.db, { orgId: "o1", planId: "pro", stripeCustomerId: "cus_123" });
    const fake = fakeStripe();
    const app = makeApp(fake.make);
    const res = await app.inject({ method: "POST", url: "/billing/portal", headers: member, payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("GET /billing is org-scoped (o2 sees its own plan/usage, not o1's)", async () => {
    await setSubscription(h.db, { orgId: "o1", planId: "pro" });
    await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "c1", displayName: "C1" });
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/billing", headers: { "x-org-id": "o2", "x-user-id": "adm2" } });
    expect(res.json().plan.id).toBe("starter"); // o2 has no subscription
    expect(res.json().usage.agents).toBe(0);     // o1's agent is not counted
    await app.close();
  });
});
